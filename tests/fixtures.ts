import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, emptyTeslaStatus } from '../src/server/store.js';
import { ingestRecord } from '../src/server/telemetry.js';
import { readConfig } from '../src/server/config.js';
import { hashPassword } from '../src/server/security.js';
import type { Gear } from '../src/shared/types.js';

export const vin = '5YJ3E1EA7KF000000';
export const testPassword = 'synthetic-test-password-only';
export const testKey = '11'.repeat(32);
export function createStore() {
  const directory = mkdtempSync(join(tmpdir(), 'lease-tracker-test-'));
  const path = join(directory, 'tracker.sqlite');
  const store = new Store(path, testKey);
  store.setSetting('tesla', { ...emptyTeslaStatus(), vehicle: { vin, name: 'Synthetic car', model: '3' } });
  return { store, path, directory, cleanup: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
export function rawEvent(at: string, gear: Gear | null, km: number | null): string {
  return JSON.stringify({ vin, createdAt: at, isResend: false, data: [{ key: 'Gear', value: gear === null ? { invalid: true } : { shiftStateValue: `ShiftState${gear}` } }, { key: 'Odometer', value: km === null ? { invalid: true } : { doubleValue: km / 1.609344 } }] });
}
export function insert(store: Store, at: string, gear: Gear | null, km: number | null) {
  return ingestRecord(store, { topic: 'tesla_V', raw: rawEvent(at, gear, km), headers: { vin }, receivedAt: '2026-12-31T23:00:00.000Z' });
}
export function config(path: string) { return readConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://127.0.0.1:3000', APP_PASSWORD_HASH: hashPassword(testPassword), ENCRYPTION_KEY: testKey, DATABASE_PATH: path }); }
