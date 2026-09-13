import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/server/app.js';
import { Store } from '../src/server/store.js';
import { seedDemo } from '../src/server/demo-data.js';
import { serviceStatus } from '../src/server/consumer.js';
import { config, testKey } from './fixtures.js';

const directory = mkdtempSync(join(tmpdir(), 'lease-tracker-e2e-'));
const path = join(directory, 'app.sqlite');
const store = new Store(path, testKey);
seedDemo(store, new Date().toISOString());
const settings = { ...config(path), origin: 'http://127.0.0.1:3100', port: 3100 };
const { app } = await buildApp(settings, store, () => serviceStatus(store, 'disabled', null));
await app.listen({ host: '127.0.0.1', port: 3100 });
const stop = async () => { await app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); };
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
