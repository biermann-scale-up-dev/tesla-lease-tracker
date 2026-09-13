import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from './store.js';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const env = z.object({ DATABASE_PATH: z.string(), ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/), BACKUP_DIR: z.string() }).parse(process.env);
const store = new Store(env.DATABASE_PATH, env.ENCRYPTION_KEY);
const abort = new AbortController();
process.on('SIGTERM', () => abort.abort());
process.on('SIGINT', () => abort.abort());
try {
  while (!abort.signal.aborted) {
    const name = `tracker-${new Date().toISOString().replaceAll(':', '-')}.sqlite`;
    await store.backup(join(env.BACKUP_DIR, name));
    console.info(JSON.stringify({ event: 'backup_completed', name }));
    const names = (await readdir(env.BACKUP_DIR)).filter(file => /^tracker-\d{4}-\d{2}-\d{2}T[\d.Z-]+\.sqlite$/.test(file)).sort();
    for (const file of names.slice(0, Math.max(0, names.length - 30))) await unlink(join(env.BACKUP_DIR, file));
    try { await delay(86_400_000, undefined, { signal: abort.signal }); } catch (error) { if (!abort.signal.aborted) throw error; }
  }
} finally { store.close(); }
