// Tesla Lease Tracker — MIT. Import into Scriptable; run once to pair.
// Scriptable controls rendering; iOS schedules background refreshes.
const connectionKey = 'lease-tracker-connection-v1';
const files = FileManager.local();
const cachePath = files.joinPath(files.documentsDirectory(), 'lease-tracker-summary-v1.json');
function eraseCache() { if (files.fileExists(cachePath)) files.remove(cachePath); }
async function connect() {
  const form = new Alert();
  form.title = 'Lease Tracker verbinden';
  form.message = 'In der Web-App unter Einstellungen einen iPhone-Code erstellen. Nur deine eigene HTTPS-Serveradresse eingeben.';
  form.addTextField('https://lease.example.com');
  form.addTextField('Einmalcode (12 Zeichen)');
  form.addAction('Verbinden'); form.addCancelAction('Abbrechen');
  if (await form.presentAlert() < 0) return null;
  const origin = form.textFieldValue(0).trim().replace(/\/$/, '');
  const code = form.textFieldValue(1).trim().toUpperCase();
  if (!/^https:\/\/[^\s/@?#]+$/.test(origin) || !/^[A-F0-9]{12}$/.test(code)) throw new Error('HTTPS-Adresse oder Einmalcode ungültig.');
  const request = new Request(`${origin}/api/pairing/claim`);
  request.method = 'POST'; request.timeoutInterval = 15;
  request.headers = { 'Content-Type': 'application/json' }; request.body = JSON.stringify({ code });
  const result = await request.loadJSON();
  if (request.response.statusCode !== 200 || typeof result.token !== 'string') throw new Error(result.error || 'Kopplung fehlgeschlagen. Neuen Code erstellen.');
  const connection = { origin, token: result.token };
  eraseCache(); Keychain.set(connectionKey, JSON.stringify(connection));
  return connection;
}
const number = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
const palette = {
  background: Color.dynamic(new Color('#edf2e7'), new Color('#1a2a23')),
  text: Color.dynamic(new Color('#213c30'), new Color('#ebf2e6')),
  muted: Color.dynamic(new Color('#56675c'), new Color('#b2c2b5')),
};
function text(widget, value, size, bold) {
  const item = widget.addText(value); item.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  item.textColor = palette.text; item.minimumScaleFactor = 0.65; item.lineLimit = 2; return item;
}
async function run() {
  let connection = Keychain.contains(connectionKey) ? JSON.parse(Keychain.get(connectionKey)) : null;
  if (!config.runsInWidget) {
    if (!connection) connection = await connect();
    else {
      const menu = new Alert(); menu.title = 'Lease Tracker'; menu.addAction('Vorschau aktualisieren'); menu.addAction('Neu verbinden'); menu.addDestructiveAction('Zugang auf diesem iPhone löschen'); menu.addCancelAction('Abbrechen');
      const choice = await menu.presentSheet();
      if (choice < 0) return;
      if (choice === 1) connection = await connect();
      if (choice === 2) { Keychain.remove(connectionKey); eraseCache(); connection = null; }
    }
  }
  let data = null; let problem = null;
  if (connection) {
    try {
      const request = new Request(`${connection.origin}/api/widget-summary`); request.timeoutInterval = 15;
      request.headers = { Authorization: `Bearer ${connection.token}` };
      const result = await request.loadJSON();
      if (request.response.statusCode === 401) { eraseCache(); Keychain.remove(connectionKey); connection = null; throw new Error('Zugriff widerrufen. Skript öffnen und neu koppeln.'); }
      if (request.response.statusCode !== 200) throw new Error(result.error || `Serverfehler (${request.response.statusCode})`);
      if (result.version !== 1 || !result.asOf || !result.quality) throw new Error('Widget-Datenformat nicht unterstützt. Skript aktualisieren.');
      data = result; files.writeString(cachePath, JSON.stringify(data));
    } catch (error) {
      problem = String(error.message || error); console.warn(`Lease Tracker: ${problem}`);
      if (connection && files.fileExists(cachePath)) {
        try { const cached = JSON.parse(files.readString(cachePath)); if (cached.version === 1) data = cached; }
        catch (cacheError) { eraseCache(); problem = `Offline-Daten unlesbar: ${String(cacheError)}`; }
      }
    }
  }
  const widget = new ListWidget();
  const accessory = config.widgetFamily === 'accessoryRectangular';
  const medium = config.widgetFamily === 'medium' || !config.runsInWidget;
  if (accessory) widget.addAccessoryWidgetBackground = true;
  else widget.backgroundColor = palette.background;
  widget.setPadding(accessory ? 0 : 12, accessory ? 0 : 14, accessory ? 0 : 12, accessory ? 0 : 14);
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  if (connection) widget.url = `${connection.origin}/#overview`;
  if (!data) {
    text(widget, 'Lease Tracker', 14, true);
    text(widget, problem || 'Skript öffnen und mit deiner Web-App koppeln.', 12, false);
  } else {
    if (!accessory) { text(widget, data.demo ? 'LEASE · DEMODATEN' : 'LEASE TRACKER', 10, true).textColor = palette.muted; widget.addSpacer(7); }
    text(widget, `${number(data.remainingKm)} km übrig`, accessory ? 18 : 26, true);
    text(widget, data.deviationKm === null ? 'Kilometerstand fehlt' : `${number(Math.abs(data.deviationKm))} km ${data.deviationKm > 0 ? 'über Soll' : 'Puffer'}`, accessory ? 11 : 12, false);
    if (medium) {
      widget.addSpacer(8);
      text(widget, data.ended ? `Vertrag beendet · ${number(data.usedKm)} km gefahren` : `${data.forecast?.label || 'Prognose'}: ${number(data.forecast?.projectedKm)} km am Ende`, 13, true);
      if (!data.ended && data.forecast?.reason) text(widget, data.forecast.reason, 10, false);
      text(widget, `Letzte Fahrt: ${number(data.lastTrip?.distanceKm)} km${data.lastTrip?.status === 'incomplete' ? ' · unvollständig' : ''}`, 12, false);
    }
    if (!accessory) widget.addSpacer();
    const date = widget.addDate(new Date(data.odometerAt || data.asOf)); date.applyRelativeStyle(); date.font = Font.systemFont(10); date.textColor = palette.muted;
    if (problem) text(widget, 'Offline · letzter Stand', 10, true);
    else if (data.quality.gaps || data.quality.incompleteTrips) text(widget, 'Daten teilweise unvollständig', 10, false);
  }
  Script.setWidget(widget);
  if (!config.runsInWidget) await widget.presentMedium();
}
try { await run(); }
catch (error) { const alert = new Alert(); alert.title = 'Lease Tracker'; alert.message = String(error.message || error); alert.addAction('OK'); if (!config.runsInWidget) await alert.presentAlert(); else console.error(alert.message); }
Script.complete();
