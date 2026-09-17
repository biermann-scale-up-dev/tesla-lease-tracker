import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { contractSchema, preferencesSchema } from '../shared/types.js';
import type { Contract, Preferences, Sample, TeslaStatus } from '../shared/types.js';
import { decrypt, digest, encrypt } from './security.js';

const jsonRow = z.object({ value: z.string() });
const sampleRow = z.object({ id: z.string(), vin: z.string(), at: z.string(), gear: z.enum(['P', 'D', 'R', 'N']).nullable(), odometerKm: z.number().nullable() });
export const teslaStatusSchema = z.object({ connected: z.boolean(), vehicle: z.object({ vin: z.string(), name: z.string(), model: z.enum(['3', 'Y']) }).nullable(), firmware: z.string().nullable(), telemetryVersion: z.string().nullable(), keyPaired: z.boolean(), configured: z.boolean(), synced: z.boolean(), checkedAt: z.string().nullable(), problem: z.string().nullable() });
export function emptyTeslaStatus(): TeslaStatus { return { connected: false, vehicle: null, firmware: null, telemetryVersion: null, keyPaired: false, configured: false, synced: false, checkedAt: null, problem: null }; }

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, private readonly encryptionKey: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`);
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=1').get()) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
          CREATE TABLE oauth_states (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
          CREATE TABLE records (id TEXT PRIMARY KEY, vin TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, raw TEXT NOT NULL, headers TEXT NOT NULL, received_at TEXT NOT NULL);
          CREATE TABLE samples (id TEXT PRIMARY KEY REFERENCES records(id), vin TEXT NOT NULL, at TEXT NOT NULL, gear TEXT, odometerKm REAL);
          CREATE INDEX samples_time ON samples(vin, at);
          CREATE TABLE rejected_records (id TEXT PRIMARY KEY, at TEXT NOT NULL, reason TEXT NOT NULL);
          INSERT INTO migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
        `);
      });
    }
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=2').get()) {
      this.transaction(() => {
        this.db.exec("ALTER TABLE oauth_states ADD COLUMN session_hash TEXT NOT NULL DEFAULT ''; INSERT INTO migrations VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));");
      });
    }
    if (!this.db.prepare('SELECT version FROM migrations WHERE version=3').get()) {
      this.transaction(() => this.db.exec(`
        CREATE TABLE devices (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, name TEXT NOT NULL, forecast_basis TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT);
        CREATE TABLE pairings (code_hash TEXT PRIMARY KEY, secret_hash TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, forecast_basis TEXT NOT NULL, approved INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        INSERT INTO migrations VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      `));
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  setting(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? JSON.parse(jsonRow.parse(row).value) as unknown : null;
  }
  setSetting(key: string, value: unknown): void { this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  contract(): Contract | null { const value = this.setting('contract'); return value === null ? null : contractSchema.parse(value); }
  preferences(): Preferences { const value = this.setting('preferences'); return value === null ? { windows: [7, 30, 90] } : preferencesSchema.parse(value); }
  teslaStatus(): TeslaStatus { const value = this.setting('tesla'); return value === null ? emptyTeslaStatus() : teslaStatusSchema.parse(value); }
  samples(vin: string): Sample[] { return this.db.prepare('SELECT id,vin,at,gear,odometerKm FROM samples WHERE vin=? ORDER BY at,id').all(vin).map(row => sampleRow.parse(row)); }
  secret(key: string): string | null { const row = this.db.prepare('SELECT value FROM secrets WHERE key=?').get(key); return row ? decrypt(jsonRow.parse(row).value, this.encryptionKey) : null; }
  setSecret(key: string, plaintext: string): void { this.db.prepare('INSERT INTO secrets VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, encrypt(plaintext, this.encryptionKey)); }
  deleteSecret(key: string): void { this.db.prepare('DELETE FROM secrets WHERE key=?').run(key); }
  addSession(token: string, now: number): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    this.db.prepare('INSERT INTO sessions VALUES (?,?)').run(digest(token), now + 7 * 86_400_000);
  }
  hasSession(token: string, now: number): boolean { return Boolean(this.db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires_at>?').get(digest(token), now)); }
  sessionExpiresAt(token: string, now: number): number | null {
    const row = this.db.prepare('SELECT expires_at FROM sessions WHERE hash=? AND expires_at>?').get(digest(token), now);
    return row ? z.object({ expires_at: z.number() }).parse(row).expires_at : null;
  }
  deleteSession(token: string): void { this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token)); }
  addOAuthState(state: string, now: number, sessionToken: string): void { this.db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(now); this.db.prepare('INSERT INTO oauth_states VALUES (?,?,?)').run(digest(state), now + 600_000, digest(sessionToken)); }
  consumeOAuthState(state: string, now: number, sessionToken: string): boolean {
    return this.db.prepare('DELETE FROM oauth_states WHERE hash=? AND expires_at>? AND session_hash=? RETURNING hash').get(digest(state), now, digest(sessionToken)) !== undefined;
  }
  rejectedCount(): number { return z.object({ count: z.number() }).parse(this.db.prepare('SELECT count(*) AS count FROM rejected_records').get()).count; }
  async backup(path: string): Promise<void> { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); await backup(this.db, path); }
  close(): void { this.db.close(); }
}
