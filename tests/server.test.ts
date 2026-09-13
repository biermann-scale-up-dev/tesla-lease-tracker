import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../src/server/app.js';
import { serviceStatus } from '../src/server/consumer.js';
import { Store } from '../src/server/store.js';
import { ingestRecord } from '../src/server/telemetry.js';
import { reconstructTrips } from '../src/shared/analytics.js';
import { hashPassword, verifyPassword, encrypt, decrypt } from '../src/server/security.js';
import { supportsBoundaryTelemetry, telemetryConfiguration } from '../src/server/tesla.js';
import { config, createStore, insert, rawEvent, testKey, testPassword, vin } from './fixtures.js';

test('HTTP login, secure session boundaries, CSRF protection, settings validation and private dashboard', async () => {
  const { store, path, cleanup } = createStore();
  const { app } = await buildApp(config(path), store, () => serviceStatus(store, 'disabled', null));
  try {
    assert.equal((await app.inject('/api/dashboard')).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/login', payload: { password: testPassword } })).statusCode, 403);
    const login = await app.inject({ method: 'POST', url: '/api/login', headers: { origin: 'http://127.0.0.1:3000' }, payload: { password: testPassword } });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies[0]!;
    assert.equal(cookie.httpOnly, true);
    const headers = { cookie: `${cookie.name}=${cookie.value}`, origin: 'http://127.0.0.1:3000' };
    assert.equal((await app.inject({ method: 'PUT', url: '/api/preferences', headers, payload: { windows: [1, 30, 365] } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/preferences', headers, payload: { windows: [0, 30, 90] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/preferences', headers: { ...headers, origin: 'https://attacker.example' }, payload: { windows: [7, 30, 90] } })).statusCode, 403);
    const dashboard = await app.inject({ url: '/api/dashboard', headers });
    assert.equal(dashboard.headers['cache-control'], 'no-store');
    assert.equal(dashboard.statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/logout', headers, payload: {} })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/dashboard', headers })).statusCode, 401);
  } finally { await app.close(); cleanup(); }
});
test('consistent backups, replay after restart, encrypted token persistence, and one-time OAuth states', async () => {
  const { store, path, directory, cleanup } = createStore();
  try {
    insert(store, '2026-03-01T08:00:00Z', 'P', 1000);
    store.setSecret('test', 'synthetic-sensitive-token');
    assert.equal(store.secret('test'), 'synthetic-sensitive-token');
    store.addOAuthState('state', 1000, 'original-session');
    assert.equal(store.consumeOAuthState('state', 1500, 'other-session'), false);
    assert.equal(store.consumeOAuthState('state', 1500, 'original-session'), true);
    assert.equal(store.consumeOAuthState('state', 1500, 'original-session'), false);
    const backup = join(directory, 'backup.sqlite'); await store.backup(backup);
    assert.equal(readFileSync(backup).includes('synthetic-sensitive-token'), false);
    const restored = new Store(backup, testKey);
    try { assert.equal(restored.samples(vin).length, 1); assert.equal(restored.secret('test'), 'synthetic-sensitive-token'); } finally { restored.close(); }
    const second = new Store(path, testKey);
    try { assert.equal(insert(second, '2026-03-01T08:00:00Z', 'P', 1000), 'duplicate'); assert.equal(second.samples(vin).length, 1); } finally { second.close(); }
  } finally { cleanup(); }
});
test('malformed or foreign telemetry is isolated without retaining unwanted data', () => {
  const { store, cleanup } = createStore();
  try {
    const incoming = { topic: 'tesla_V', raw: rawEvent('2026-03-01T08:00:00Z', 'P', 1000), headers: { vin }, receivedAt: '2026-03-01T09:00:00Z' };
    assert.equal(ingestRecord(store, { ...incoming, headers: { vin: 'FOREIGN' } }), 'rejected');
    assert.equal(ingestRecord(store, { ...incoming, raw: '{broken' }), 'rejected');
    assert.equal(store.samples(vin).length, 0);
    assert.equal(store.rejectedCount(), 2);
    assert.equal(ingestRecord(store, incoming), 'inserted');
    assert.equal(store.samples(vin).length, 1);
  } finally { cleanup(); }
});
test('crypto rejects tampering and password mismatch; telemetry config contains only the two requested signals', () => {
  const hash = hashPassword(testPassword);
  assert.equal(verifyPassword(testPassword, hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  const ciphertext = encrypt('secret', testKey);
  assert.equal(decrypt(ciphertext, testKey), 'secret');
  assert.throws(() => decrypt(ciphertext, '22'.repeat(32)));
  assert.equal(supportsBoundaryTelemetry('1.3.0'), true);
  assert.equal(supportsBoundaryTelemetry('2.0.0'), true);
  assert.equal(supportsBoundaryTelemetry('1.2.99'), false);
  assert.equal(supportsBoundaryTelemetry(null), false);
  assert.deepEqual(telemetryConfiguration('telemetry.example.com', 8443, 'public-ca').fields, { Gear: { interval_seconds: 1, include_fields: ['Odometer'] } });
});

test('disconnect never ends a trip and late connectivity events cannot replace newer status', () => {
  const { store, cleanup } = createStore();
  try {
    insert(store, '2026-03-01T07:00:00Z', 'P', 1000);
    insert(store, '2026-03-01T08:00:00Z', 'D', 1000);
    for (const [createdAt, status] of [['2026-03-01T09:00:00Z', 'DISCONNECTED'], ['2026-03-01T08:00:00Z', 'CONNECTED']]) {
      assert.equal(ingestRecord(store, { topic: 'tesla_connectivity', raw: JSON.stringify({ vin, createdAt, status }), headers: { vin }, receivedAt: '2026-03-01T10:00:00Z' }), 'inserted');
    }
    assert.equal(serviceStatus(store, 'connected', null).vehicleConnectivity, 'DISCONNECTED');
    const trip = reconstructTrips(store.samples(vin)).trips[0]!;
    assert.equal(trip.status, 'open'); assert.equal(trip.end, null);
  } finally { cleanup(); }
});
