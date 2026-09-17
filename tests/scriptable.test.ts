import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildApp } from '../src/server/app.js';
import { serviceStatus } from '../src/server/consumer.js';
import { seedDemo } from '../src/server/demo-data.js';
import { config, createStore, testPassword } from './fixtures.js';
import type { PairedDevice } from '../src/shared/types.js';

// Host rendering is an adapter: HTTP/auth/storage use the real app and SQLite.
// This checks the distributed script, not native iOS layout or scheduling.
class WidgetAdapter {
  readonly text: string[] = [];
  refreshAfterDate: Date | null = null;
  addText(value: string) { this.text.push(value); return {}; }
  addDate(value: Date) { this.text.push(value.toISOString()); return { applyRelativeStyle() {} }; }
  setPadding() {}
  addSpacer() {}
}
class ColorAdapter { static dynamic(light: unknown) { return light; } }

test('distributed Scriptable artifact: three widget families, cached outage, and real API revocation', async () => {
  const { store, path, cleanup } = createStore();
  store.db.prepare("DELETE FROM settings WHERE key='tesla'").run(); seedDemo(store, new Date().toISOString());
  const { app } = await buildApp(config(path), store, () => serviceStatus(store, 'disabled', null));
  try {
    const origin = 'http://127.0.0.1:3000';
    const login = await app.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { password: testPassword } });
    const owner = { origin, cookie: `session=${login.cookies[0]!.value}` };
    const pair = (await app.inject({ method: 'POST', url: '/api/pairing/scriptable', headers: owner, payload: { name: 'Artifact', forecastBasis: 'window-1' } })).json<{ code: string }>();
    const claim = await app.inject({ method: 'POST', url: '/api/pairing/claim', payload: { code: pair.code } });
    assert.equal(claim.statusCode, 200);
    const { token } = claim.json<{ token: string }>();
    const keychain = new Map([['lease-tracker-connection-v1', JSON.stringify({ origin, token })]]);
    const files = new Map<string, string>();
    const rendered: WidgetAdapter[] = [];
    const errors: string[] = [];
    let unavailable = false;
    class RequestAdapter {
      headers: Record<string, string> = {};
      response = { statusCode: 0 };
      constructor(readonly url: string) {}
      async loadJSON(): Promise<unknown> {
        if (unavailable) throw new Error('Synthetic server outage');
        const response = await app.inject({ url: new URL(this.url).pathname, headers: this.headers });
        this.response = { statusCode: response.statusCode }; return response.json<unknown>();
      }
    }
    const script = readFileSync('public/lease-tracker.scriptable.js', 'utf8');
    const execute = async (family: string) => {
      await runInNewContext(`(async () => { ${script}\n })()`, {
        config: { runsInWidget: true, widgetFamily: family }, Request: RequestAdapter, ListWidget: WidgetAdapter,
        Color: ColorAdapter, Font: { boldSystemFont: () => 'bold', systemFont: () => 'normal' },
        FileManager: { local: () => ({ joinPath: (dir: string, file: string) => `${dir}/${file}`, documentsDirectory: () => '/synthetic', fileExists: (file: string) => files.has(file), remove: (file: string) => files.delete(file), readString: (file: string) => files.get(file), writeString: (file: string, value: string) => files.set(file, value) }) },
        Keychain: { contains: (key: string) => keychain.has(key), get: (key: string) => keychain.get(key), set: (key: string, value: string) => keychain.set(key, value), remove: (key: string) => keychain.delete(key) },
        Script: { setWidget: (widget: WidgetAdapter) => rendered.push(widget), complete() {} },
        console: { warn() {}, error: (value: string) => errors.push(value) },
      });
      return rendered.at(-1)!;
    };
    for (const family of ['small', 'medium', 'accessoryRectangular']) {
      const before = Date.now(); const widget = await execute(family);
      assert.ok(widget.text.some(value => value.endsWith('km übrig')));
      assert.ok(widget.refreshAfterDate!.getTime() >= before + 30 * 60000);
      assert.equal(widget.text.some(value => value.startsWith('Letzte Fahrt:')), family === 'medium');
    }
    unavailable = true; assert.ok((await execute('small')).text.includes('Offline · letzter Stand')); assert.equal(files.size, 1);
    unavailable = false;
    const [device] = (await app.inject({ url: '/api/devices', headers: owner })).json<PairedDevice[]>();
    await app.inject({ method: 'DELETE', url: `/api/devices/${device!.id}`, headers: owner });
    const revoked = await execute('small');
    assert.ok(revoked.text.some(value => value.includes('widerrufen')));
    assert.equal(files.size, 0); assert.equal(keychain.size, 0); assert.deepEqual(errors, []);
  } finally { await app.close(); cleanup(); }
});
