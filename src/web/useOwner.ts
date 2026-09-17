import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dashboard, OfflineSnapshot, Session } from '../shared/types.js';
import { ApiError, errorMessage, getJSON, sendJSON } from './api.js';
import { clearSnapshot, logoutKey, makeSnapshot, readSnapshot, saveSnapshot } from './offline.js';

export function useOwner() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const generation = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const lock = useCallback(async () => {
    generation.current++;
    setAuthenticated(false); setDashboard(null); setSnapshot(null); setExpiresAt(null);
    try { await clearSnapshot(); } catch (cause) { setError(errorMessage(cause)); }
  }, []);
  const load = useCallback((): Promise<void> => {
    if (pending.current) return pending.current;
    const run = async () => {
      const current = generation.current;
      setLoading(true);
      try {
        if (localStorage.getItem(logoutKey)) {
          await clearSnapshot();
          await sendJSON('/api/logout', 'POST', {});
          localStorage.removeItem(logoutKey);
        }
        const session = await getJSON<Session>('/api/session');
        if (current !== generation.current) return;
        if (!session.authenticated || session.expiresAt === null) { await lock(); setError(null); return; }
        const data = await getJSON<Dashboard>('/api/dashboard');
        if (current !== generation.current) return;
        setDashboard(data); setSnapshot(null); setAuthenticated(true); setExpiresAt(session.expiresAt); setError(null);
        try { await saveSnapshot(makeSnapshot(data, session.expiresAt), () => current === generation.current); }
        catch (cause) { if (current === generation.current) setError(`Aktuelle Daten geladen, aber Offline-Sicherung fehlgeschlagen: ${errorMessage(cause)}`); }
      } catch (cause) {
        if (current !== generation.current) return;
        if (cause instanceof ApiError && cause.status === 401) { await lock(); return; }
        // Only transport/5xx failures can use a previous authenticated snapshot.
        const cached = !(cause instanceof ApiError) || cause.status >= 500 ? await readSnapshot().catch(storageError => { setError(errorMessage(storageError)); return null; }) : null;
        if (current !== generation.current) return;
        if (cached) { setSnapshot(cached); setDashboard(null); setAuthenticated(true); setExpiresAt(cached.expiresAt); }
        else { setAuthenticated(false); setDashboard(null); setSnapshot(null); }
        setError(`Verbindung oder Offline-Speicher nicht verfügbar: ${errorMessage(cause)}`);
      } finally { setLoading(false); }
    };
    pending.current = run().finally(() => { pending.current = null; });
    return pending.current;
  }, [lock]);
  const logout = useCallback(async () => {
    localStorage.setItem(logoutKey, String(Date.now()));
    await lock();
    try { await sendJSON('/api/logout', 'POST', {}); localStorage.removeItem(logoutKey); setError(null); }
    catch (cause) { setError(`Auf diesem Gerät abgemeldet. Server-Abmeldung folgt bei Verbindung. ${errorMessage(cause)}`); }
  }, [lock]);
  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const expired = () => { void lock().catch(cause => setError(errorMessage(cause))); };
    const otherTab = (event: StorageEvent) => { if (event.key === logoutKey && event.newValue) expired(); };
    window.addEventListener('online', refresh); window.addEventListener('session-expired', expired); window.addEventListener('storage', otherTab);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('online', refresh); window.removeEventListener('session-expired', expired); window.removeEventListener('storage', otherTab); document.removeEventListener('visibilitychange', refresh); };
  }, [load, lock]);
  useEffect(() => {
    if (expiresAt === null) return;
    const timeout = setTimeout(() => { void lock().catch(cause => setError(errorMessage(cause))); }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [expiresAt, lock]);
  return { authenticated, dashboard, snapshot, error, loading, load, logout };
}
