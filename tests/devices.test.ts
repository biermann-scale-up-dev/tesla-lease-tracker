import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { serviceStatus } from '../src/server/consumer.js';
import { config, createStore, testPassword, insert, testKey } from './fixtures.js';
import { Store } from '../src/server/store.js';
import { seedDemo } from '../src/server/demo-data.js';
import { digest } from '../src/server/security.js';
import { makeSnapshot } from '../src/web/offline.js';
import type { Dashboard, PairedDevice, Session, WidgetSummary } from '../src/shared/types.js';

test('device pairing, forecast selection, hashed persistence, owner/device isolation and revocation', async () => {
  const { store, path, cleanup } = createStore();
  store.db.prepare("DELETE FROM settings WHERE key='tesla'").run();
  seedDemo(store, new Date().toISOString());
  const { app } = await buildApp(config(path), store, () => serviceStatus(store, 'disabled', null));
  try {
    const origin = 'http://127.0.0.1:3000';
    const login = await app.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { password: testPassword } });
    const owner = { origin, cookie: `session=${login.cookies[0]!.value}` };
    const session = (await app.inject({ url: '/api/session', headers: owner })).json<Session>();
    assert.equal(session.authenticated, true); assert.ok(session.expiresAt! > Date.now());
    const issue = await app.inject({ method: 'POST', url: '/api/pairing/scriptable', headers: owner, payload: { name: 'Test phone', forecastBasis: 'window-1' } });
    assert.equal(issue.statusCode, 200);
    const { code } = issue.json<{ code: string }>();
    const claim = await app.inject({ method: 'POST', url: '/api/pairing/claim', payload: { code } });
    assert.equal(claim.statusCode, 200);
    const { token } = claim.json<{ token: string }>();
    const headers = { authorization: `Bearer ${token}` };
    assert.equal((await app.inject({ method: 'POST', url: '/api/pairing/claim', payload: { code } })).statusCode, 400);
    for (const url of ['/api/dashboard', '/api/devices', '/api/tesla/vehicles']) assert.equal((await app.inject({ url, headers })).statusCode, 401);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/preferences', headers: { ...headers, origin }, payload: { windows: [1, 2, 3] } })).statusCode, 401);
    const widget = await app.inject({ url: '/api/widget-summary', headers });
    assert.equal(widget.statusCode, 200); assert.equal(widget.headers['cache-control'], 'no-store');
    const summary = widget.json<WidgetSummary>();
    assert.equal(summary.forecast?.id, 'window-1');
    assert.equal(widget.body.includes('vin'), false); assert.equal(widget.body.includes('handover'), false);
    const dashboard = (await app.inject({ url: '/api/dashboard', headers: owner })).json<Dashboard>();
    assert.equal(summary.usedKm, dashboard.summary!.usedKm);
    assert.equal(summary.remainingKm, dashboard.summary!.remainingKm);
    const offline = makeSnapshot(dashboard, session.expiresAt!);
    assert.equal(offline.summary!.trips.length, 20);
    assert.equal(JSON.stringify(offline).includes('vin'), false);
    assert.equal(JSON.stringify(offline).includes('handoverKm'), false);
    assert.equal(offline.summary!.forecasts.length, 4);
    const devices = (await app.inject({ url: '/api/devices', headers: owner })).json<PairedDevice[]>();
    const device = devices[0]!; assert.ok(device.lastUsedAt);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/devices/${device.id}`, headers: owner, payload: { name: 'Changed', forecastBasis: 'contract' } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/widget-summary', headers })).json<WidgetSummary>().forecast?.id, 'contract');
    const second = new Store(path, testKey);
    try { assert.equal(second.db.prepare('SELECT hash FROM devices WHERE id=?').get(device.id)?.hash, digest(token)); } finally { second.close(); }
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/devices/${device.id}`, headers: owner })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/widget-summary', headers })).statusCode, 401);
  } finally { await app.close(); cleanup(); }
});

test('Tesla approval requires owner consent and browser secret; expiry, CSRF and empty data stay explicit', async () => {
  const { store, path, cleanup } = createStore();
  const { app } = await buildApp(config(path), store, () => serviceStatus(store, 'disabled', null));
  try {
    const origin = 'http://127.0.0.1:3000';
    const start = await app.inject({ method: 'POST', url: '/api/pairing/tesla', headers: { origin }, payload: {} });
    const pair = start.json<{ code: string; secret: string; approvalUrl: string }>();
    assert.equal(pair.approvalUrl.includes(pair.secret), false);
    assert.equal((await app.inject({ method: 'POST', url: '/api/pairing/claim', payload: { code: pair.code } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/pairing/claim', headers: { origin }, payload: { code: pair.code, secret: pair.secret } })).statusCode, 202);
    assert.equal((await app.inject({ method: 'POST', url: '/api/pairing/approve', headers: { origin }, payload: { code: pair.code, name: 'Tesla', forecastBasis: 'window-1' } })).statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { password: testPassword } });
    const owner = { origin, cookie: `session=${login.cookies[0]!.value}` };
    const approve = { code: pair.code, name: 'Tesla', forecastBasis: 'window-1' };
    assert.equal((await app.inject({ method: 'POST', url: '/api/pairing/approve', headers: { ...owner, origin: 'https://evil.example' }, payload: approve })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/pairing/approve', headers: owner, payload: approve })).statusCode, 200);
    const claim = await app.inject({ method: 'POST', url: '/api/pairing/claim', headers: { origin }, payload: { code: pair.code, secret: pair.secret } });
    assert.equal(claim.statusCode, 200); assert.equal(claim.json<{ token?: string }>().token, undefined);
    const cookie = claim.cookies[0]!; assert.equal(cookie.httpOnly, true); assert.equal(cookie.path, '/api/widget-summary');
    const headers = { cookie: `widget_device=${cookie.value}` };
    const summary = (await app.inject({ url: '/api/widget-summary', headers })).json<WidgetSummary>();
    assert.equal(summary.remainingKm, null); assert.equal(summary.forecast, null);
    assert.equal((await app.inject({ url: '/api/dashboard', headers })).statusCode, 401);
    const expired = (await app.inject({ method: 'POST', url: '/api/pairing/scriptable', headers: owner, payload: { name: 'Expired', forecastBasis: 'window-0' } })).json<{ code: string }>();
    store.db.prepare('UPDATE pairings SET expires_at=? WHERE code_hash=?').run(Date.now() - 1, digest(expired.code));
    assert.equal((await app.inject({ method: 'POST', url: '/api/pairing/claim', payload: { code: expired.code } })).statusCode, 400);
    insert(store, '2026-03-01T08:00:00Z', 'D', null);
    for (let attempt = 0; attempt < 25; attempt++) await app.inject({ method: 'POST', url: '/api/pairing/claim', payload: { code: '000000000000' } });
    assert.equal((await app.inject({ method: 'POST', url: '/api/pairing/claim', payload: { code: '000000000000' } })).statusCode, 429);
  } finally { await app.close(); cleanup(); }
});
