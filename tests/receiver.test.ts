import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { receiverStatus } from '../src/server/receiver-status.js';

test('receiver probe distinguishes healthy service, HTTP failure and an offline receiver', async () => {
  const server = createServer((request, response) => {
    response.statusCode = request.url === '/status' ? 200 : 503;
    response.end(request.url === '/status' ? 'ok' : 'unavailable');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal(await receiverStatus(`${origin}/status`), 'connected');
    assert.equal(await receiverStatus(`${origin}/failed`), 'error');
    assert.equal(await receiverStatus(''), 'unchecked');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  assert.equal(await receiverStatus(`${origin}/status`), 'error');
  const config: unknown = JSON.parse(readFileSync('ops/telemetry.json', 'utf8'));
  assert.ok(config && typeof config === 'object' && 'reliable_ack_sources' in config);
  assert.deepEqual(config.reliable_ack_sources, { V: 'kafka' });
});
