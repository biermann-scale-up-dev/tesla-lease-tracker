import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
// Give independent synthetic browser scenarios separate limiter identities.
app.addHook('onRequest', async request => {
  const client = request.headers['x-test-client'];
  if (typeof client === 'string') Object.defineProperty(request, 'ip', { value: client });
});
let networkAvailable = true;
app.addHook('onRequest', async (request, reply) => {
  if (!networkAvailable && !request.url.startsWith('/test/')) { reply.hijack(); request.raw.socket.destroy(); }
});
app.post('/test/network', async request => { networkAvailable = (request.body as { available: boolean }).available; return { ok: true }; });
let workerRevision = 0;
app.get('/sw.js', async (_request, reply) => reply.type('application/javascript').header('Cache-Control', 'no-store').send(readFileSync('dist/sw.js', 'utf8').replace('lease-shell-', `lease-shell-test-${workerRevision}-`)));
app.post('/test/worker-update', async () => { workerRevision++; return { ok: true }; });
await app.listen({ host: '127.0.0.1', port: 3100 });
const stop = async () => { await app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); };
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
