import { test, expect } from '@playwright/test';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { testPassword } from '../fixtures.js';

test.beforeEach(async ({ context }, testInfo) => { await context.setExtraHTTPHeaders({ 'x-test-client': testInfo.testId }); });

test.afterEach(async ({ request }) => { await request.post('/test/network', { data: { available: true } }); });

async function offline(context: BrowserContext, request: APIRequestContext, browserName: string, value: boolean) {
  // WebKit's emulated offline reload fails in the automation layer. Drop real
  // server connections instead, retaining real worker/cache/IndexedDB behavior.
  if (browserName === 'webkit') {
    await request.post('/test/network', { data: { available: !value } });
    if (value) await expect(request.get('/index.html')).rejects.toThrow();
  } else await context.setOffline(value);
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('App-Passwort', { exact: true }).fill(testPassword);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deine Kilometer im Blick.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aktualisieren', exact: true })).toBeEnabled();
}
async function navigate(page: Page, name: string) {
  const link = page.getByRole('navigation').getByRole('link', { name, exact: true });
  await link.click(); await expect(link).toHaveAttribute('aria-current', 'page');
}
// Exercise the in-page reload path (also used by installed-app updates).
async function reloadApp(page: Page) {
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => location.reload())]);
}
async function snapshotExists(page: Page) {
  return page.evaluate(async () => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open('lease-offline', 1);
    open.onsuccess = () => { const db = open.result; const request = db.transaction('snapshots').objectStore('snapshots').get('current'); request.onsuccess = () => { db.close(); resolve(Boolean(request.result)); }; request.onerror = () => reject(request.error); };
    open.onerror = () => reject(open.error);
  }));
}

test('four sections, comparable forecasts, editing, history navigation and responsive themes', async ({ page }, testInfo) => {
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
  await login(page);
  await page.screenshot({ path: `docs/images/dashboard-${testInfo.project.name}.png`, fullPage: testInfo.project.name === 'desktop' });
  await navigate(page, 'Auswertungen');
  await expect(page.getByRole('cell', { name: 'Seit Vertragsbeginn', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '30 Tage', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '90 Tage', exact: true })).toBeVisible();
  await page.getByLabel('Prognosezeitraum 1').fill('14');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('cell', { name: '14 Tage', exact: true })).toBeVisible();
  await reloadApp(page); await expect(page.getByLabel('Prognosezeitraum 1')).toHaveValue('14');
  for (const period of ['monthly', 'yearly', 'weekly', 'daily']) await page.getByLabel('Zeitraum der Kilometer-Auswertung').selectOption(period);
  await page.getByLabel('Prognosezeitraum 1').fill('7'); await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('cell', { name: '7 Tage', exact: true })).toBeVisible();
  await page.screenshot({ path: `docs/images/analytics-${testInfo.project.name}.png`, fullPage: true });
  await navigate(page, 'Fahrten');
  await expect(page.getByRole('heading', { name: 'Fahrtenbuch' })).toBeVisible();
  if (testInfo.project.name !== 'desktop') { await page.locator('.trip-card summary').first().click(); await expect(page.locator('.trip-card[open]')).toContainText('Startstand'); }
  await page.goBack(); await expect(page.getByLabel('Prognosezeitraum 1')).toBeVisible();
  await navigate(page, 'Einstellungen');
  await page.getByLabel('Verbindliche Vertragsgesamt-km').fill('61000'); await page.getByRole('button', { name: 'Vertrag speichern' }).click();
  await expect(page.getByText('Dein Leasingvertrag wurde gespeichert.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vertrag speichern' })).toBeEnabled();
  await reloadApp(page); await expect(page.getByLabel('Verbindliche Vertragsgesamt-km')).toHaveValue('61000');
  await page.getByLabel('Verbindliche Vertragsgesamt-km').fill('60000'); await page.getByRole('button', { name: 'Vertrag speichern' }).click();
  await expect(page.getByText('Dein Leasingvertrag wurde gespeichert.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vertrag speichern' })).toBeEnabled();
  for (const theme of ['dark', 'light']) {
    await page.getByLabel('Farbschema').selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    if (theme === 'dark') {
      await navigate(page, 'Übersicht');
      await page.screenshot({ path: `docs/images/dashboard-dark-${testInfo.project.name}.png`, fullPage: testInfo.project.name === 'desktop' });
      await navigate(page, 'Einstellungen');
    }
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const section of ['Übersicht', 'Fahrten', 'Auswertungen', 'Einstellungen']) {
        await navigate(page, section);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});

test('offline relaunch freezes data, limits trips, disables writes, clears data and completes offline logout', async ({ page, context, request, browserName }) => {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => snapshotExists(page)).toBe(true);
  const snapshot = await page.evaluate(async () => new Promise<string>(resolve => {
    const open = indexedDB.open('lease-offline'); open.onsuccess = () => { const db = open.result; const request = db.transaction('snapshots').objectStore('snapshots').get('current'); request.onsuccess = () => { db.close(); resolve(JSON.stringify(request.result)); }; };
  }));
  expect(snapshot).not.toContain('vin'); expect(snapshot).not.toContain('handoverKm'); expect(JSON.parse(snapshot).summary.trips).toHaveLength(20);
  await offline(context, request, browserName, true); await reloadApp(page);
  await expect(page.getByRole('status')).toContainText('Offline · Gespeichert');
  await navigate(page, 'Auswertungen'); await expect(page.getByLabel('Prognosezeitraum 1')).toBeDisabled();
  await navigate(page, 'Einstellungen'); await expect(page.getByText('Vertrag, Tesla-Verbindung und Geräteverwaltung sind online verfügbar.')).toBeVisible();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  await reloadApp(page); await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  expect(await snapshotExists(page)).toBe(false);
  await offline(context, request, browserName, false); await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeEnabled();
  expect(await page.evaluate(async () => (await fetch('/api/session')).json())).toMatchObject({ authenticated: false, expiresAt: null });
});

test('expired offline snapshot and rejected online session cannot expose old data', async ({ page, context, request, browserName }) => {
  await login(page); await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => snapshotExists(page)).toBe(true);
  await context.clearCookies(); await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  expect(await snapshotExists(page)).toBe(false);
  await login(page); await expect.poll(() => snapshotExists(page)).toBe(true);
  await offline(context, request, browserName, true);
  await page.evaluate(async () => new Promise<void>(resolve => {
    const open = indexedDB.open('lease-offline'); open.onsuccess = () => { const db = open.result; const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots'); const request = store.get('current'); request.onsuccess = () => store.put({ ...request.result, expiresAt: Date.now() - 1 }, 'current'); tx.oncomplete = () => { db.close(); resolve(); }; };
  }));
  await reloadApp(page); await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  expect(await snapshotExists(page)).toBe(false);
});

test('Tesla QR approval, persisted reader cookie, forecast selection and revocation', async ({ page, browser }, testInfo) => {
  await login(page);
  const carContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: 'http://127.0.0.1:3100' });
  const car = await carContext.newPage();
  try {
    await car.goto('/tesla'); await car.getByRole('button', { name: 'Mit Smartphone koppeln' }).click();
    await expect(car.getByAltText('QR-Code zur Freigabe auf deinem Smartphone')).toBeVisible();
    const code = await car.locator('.qr-pair h2').innerText();
    await page.goto(`/#settings?pair=${code}`);
    await page.getByRole('button', { name: 'Tesla-Zugriff bestätigen' }).click();
    await expect(car.locator('.tesla-grid')).toBeVisible({ timeout: 15000 });
    await car.reload(); await expect(car.locator('.tesla-grid')).toBeVisible();
    await car.screenshot({ path: `docs/images/tesla-${testInfo.project.name}.png`, fullPage: true });
    expect((await carContext.request.get('/api/dashboard')).status()).toBe(401);
    await page.getByRole('button', { name: 'Geräteliste aktualisieren' }).click();
    const device = page.locator('.device-row').filter({ hasText: 'Tesla-Browser' }).last();
    await device.getByRole('combobox').selectOption('contract');
    await car.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
    await expect(car.locator('.tesla-grid')).toContainText('Seit Vertragsbeginn');
    await device.getByRole('button', { name: 'Widerrufen' }).click();
    await car.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
    await expect(car.getByRole('button', { name: 'Mit Smartphone koppeln' })).toBeVisible();
    expect(await car.evaluate(() => localStorage.getItem('lease-tesla-summary'))).toBeNull();
  } finally { await carContext.close(); }
});

test('private API, wrong password and PWA public assets', async ({ page, request }) => {
  expect((await request.get('/api/dashboard')).status()).toBe(401);
  await page.goto('/'); await page.getByLabel('App-Passwort', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Das Passwort stimmt nicht.');
  expect(await (await request.get('/manifest.webmanifest')).json()).toMatchObject({ display: 'standalone', lang: 'de' });
  expect((await request.get('/icon-192.png')).headers()['content-type']).toContain('image/png');
  const sw = await (await request.get('/sw.js')).text(); expect(sw).not.toContain('__REVISION__');
  expect((await request.get('/lease-tracker.scriptable.js')).ok()).toBe(true);
});

test('service worker update waits for consent and saved forms', async ({ page, request }) => {
  await login(page); await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await navigate(page, 'Auswertungen'); await page.getByLabel('Prognosezeitraum 1').fill('21');
  await request.post('/test/worker-update');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
  const update = page.getByRole('button', { name: 'Jetzt aktualisieren' });
  await expect(update).toBeVisible({ timeout: 15000 }); await expect(update).toBeDisabled();
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click(); await expect(update).toBeEnabled();
  await update.click(); await expect(page.getByLabel('Prognosezeitraum 1')).toHaveValue('21');
  await page.getByLabel('Prognosezeitraum 1').fill('7'); await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('cell', { name: '7 Tage', exact: true })).toBeVisible();
});


test.describe('unavailable readings and storage', () => {
  // Route interception must own this synthetic response in every browser.
  // Real service-worker behavior is exercised by the offline/update journeys.
  test.use({ serviceWorkers: 'block' });

  test('missing readings and full offline storage keep the live UI explicit and usable', async ({ page }) => {
    await page.addInitScript(() => {
      IDBObjectStore.prototype.put = function () { throw new DOMException('Synthetic full storage', 'QuotaExceededError'); };
    });
    await page.route('**/api/dashboard', async route => {
      const response = await route.fetch();
      const dashboard = await response.json();
      const summary = dashboard.summary;
      await route.fulfill({ json: { ...dashboard, summary: {
        ...summary, usedKm: null, remainingKm: null, deviationKm: null, odometerKm: null,
        forecasts: summary.forecasts.map((forecast: { id: string }) => ({ ...forecast, dailyKm: null, projectedKm: null, remainingKm: null, reason: 'Gültiger Kilometerstand fehlt' })),
        gaps: [{ start: summary.asOf, end: summary.asOf, reason: 'Fahrtgrenze fehlt', unassignedKm: 42 }], unassignedKm: 42,
      } } });
    });
    await login(page);
    await expect(page.locator('.hero-number')).toContainText('—');
    await expect(page.getByRole('alert').filter({ hasText: 'Offline-Sicherung fehlgeschlagen' })).toBeVisible();
    await expect(page.locator('.overview-forecast')).toContainText('Gültiger Kilometerstand fehlt');
    await expect(page.getByText(/42,0 km nicht zugeordnet/)).toBeVisible();
    await navigate(page, 'Auswertungen');
    await expect(page.getByText('Gültiger Kilometerstand fehlt', { exact: true })).toHaveCount(4);
    await expect(page.getByLabel('Prognosezeitraum 1')).toBeEnabled();
  });
});
