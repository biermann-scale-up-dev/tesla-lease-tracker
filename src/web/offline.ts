import type { Dashboard, OfflineSnapshot } from '../shared/types.js';

export const logoutKey = 'lease-logout-pending';
const databaseName = 'lease-offline';
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Offline-Speicher kann nicht geöffnet werden.'));
  });
}
async function storage<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => Pick<IDBRequest<T>, 'result'>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('snapshots', mode);
      tx.onabort = () => { db.close(); reject(new Error('Offline-Daten konnten nicht verarbeitet werden.')); };
      const request = operation(tx.objectStore('snapshots'));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
    } catch (cause) { db.close(); reject(cause); }
  });
}
export async function clearSnapshot(): Promise<void> { await storage('readwrite', store => store.clear()); }
export function makeSnapshot(data: Dashboard, expiresAt: number): OfflineSnapshot {
  return {
    version: 1, savedAt: new Date().toISOString(), expiresAt, demo: data.demo,
    contract: data.contract ? { startDate: data.contract.startDate, endDate: data.contract.endDate, totalKm: data.contract.totalKm, timeZone: data.contract.timeZone } : null,
    preferences: data.preferences, summary: data.summary ? { ...data.summary, trips: data.summary.trips.slice(0, 20) } : null,
  };
}
export async function saveSnapshot(snapshot: OfflineSnapshot, active: () => boolean): Promise<void> {
  if (!active() || localStorage.getItem(logoutKey)) return;
  await storage('readwrite', store => !active() || localStorage.getItem(logoutKey) ? store.get('current') : store.put(snapshot, 'current'));
}
export async function readSnapshot(): Promise<OfflineSnapshot | null> {
  if (localStorage.getItem(logoutKey)) return null;
  const data: unknown = await storage('readonly', store => store.get('current'));
  if (!data) return null;
  if (typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('expiresAt' in data) || typeof data.expiresAt !== 'number' || data.expiresAt <= Date.now()) {
    await clearSnapshot(); return null;
  }
  return data as OfflineSnapshot;
}
