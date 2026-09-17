import { useCallback, useEffect, useState } from 'react';
import type { DeviceSettings, Forecast, PairedDevice } from '../shared/types.js';
import { forecastBasisSchema } from '../shared/types.js';
import { dateTime, errorMessage, getJSON, sendJSON } from './api.js';
import { useDirty } from './Experience.js';

export function DeviceSettingsPanel({ forecasts }: { forecasts: Forecast[] }) {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [name, setName] = useState('Mein iPhone');
  const [basis, setBasis] = useState<DeviceSettings['forecastBasis']>('window-1');
  const [code, setCode] = useState<string | null>(null);
  const [approval, setApproval] = useState(() => new URLSearchParams(location.hash.split('?')[1]).get('pair') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => setDevices(await getJSON<PairedDevice[]>('/api/devices')), []);
  useEffect(() => { void refresh().catch(cause => setError(errorMessage(cause))); }, [refresh]);
  useDirty('pairing', name !== 'Mein iPhone' || approval !== '');
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await work(); await refresh(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  const choices = ['window-0', 'window-1', 'window-2', 'contract'].map((id, index) => ({ id, label: forecasts.find(item => item.id === id)?.label ?? ['Zeitraum 1', 'Zeitraum 2', 'Zeitraum 3', 'Seit Vertragsbeginn'][index] }));
  return <section className="card devices-panel"><div className="section-heading"><h2>Widgets und gekoppelte Geräte</h2><button className="button secondary" disabled={busy} onClick={() => void act(refresh)}>Geräteliste aktualisieren</button></div>
    <p>Jedes Gerät erhält eigenen Lesezugriff. Du kannst ihn hier jederzeit widerrufen.</p>
    {error && <p className="alert error" role="alert">{error}</p>}{message && <p className="alert success" role="status">{message}</p>}
    <div className="settings-grid setting-control"><div><h3>iPhone-Widget einrichten</h3><p>Scriptable installieren, das Skript importieren und einmal mit Server-Adresse und Code starten. Danach ein kleines, mittleres oder rechteckiges Sperrbildschirm-Widget hinzufügen.</p><a className="button secondary" href="/lease-tracker.scriptable.js" download>Scriptable-Skript herunterladen</a></div>
      <div className="pairing-form"><label>Gerätename<input value={name} maxLength={60} onChange={event => setName(event.target.value)}/></label><label>Widget-Prognose<select value={basis} onChange={event => setBasis(forecastBasisSchema.parse(event.target.value))}>{choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button className="button primary" disabled={busy || !name.trim()} onClick={() => void act(async () => { const result = await sendJSON<{ code: string }>('/api/pairing/scriptable', 'POST', { name, forecastBasis: basis }); setCode(result.code); setName('Mein iPhone'); })}>iPhone-Code erstellen</button>{code && <p className="pair-code" role="status"><strong>{code}</strong><small>Einmalcode · zehn Minuten gültig</small></p>}</div>
    </div>
    <details className="diagnostics" open={approval !== ''}><summary>Tesla-Browser koppeln</summary><p>Im Fahrzeug <strong>{location.origin}/tesla</strong> öffnen. QR-Code mit deinem Smartphone scannen und den im Fahrzeug angezeigten Code hier bestätigen.</p><label className="setting-control">Tesla-Kopplungscode<input value={approval} maxLength={12} autoCapitalize="characters" onChange={event => setApproval(event.target.value.toUpperCase())}/></label><button className="button primary" disabled={busy || !/^[A-F0-9]{12}$/.test(approval)} onClick={() => void act(async () => { await sendJSON('/api/pairing/approve', 'POST', { code: approval, name: 'Tesla-Browser', forecastBasis: basis }); setApproval(''); history.replaceState(null, '', '#settings'); setMessage('Tesla-Browser freigegeben. Die Ansicht öffnet sich im Fahrzeug.'); })}>Tesla-Zugriff bestätigen</button></details>
    <div className="device-list">{devices.map(device => <article key={device.id} className="device-row"><div><strong>{device.name}</strong><small>{device.kind === 'tesla' ? 'Tesla-Browser' : 'Scriptable'} · Zuletzt: {dateTime(device.lastUsedAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}</small></div><label>Prognose für {device.name}<select value={device.forecastBasis} disabled={busy} onChange={event => { const forecastBasis = forecastBasisSchema.parse(event.target.value); void act(async () => { await sendJSON(`/api/devices/${device.id}`, 'PUT', { name: device.name, forecastBasis }); }); }}>{choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button className="button secondary danger" disabled={busy} onClick={() => void act(async () => { await sendJSON(`/api/devices/${device.id}`, 'DELETE', {}); setMessage(`${device.name}: Zugriff widerrufen.`); })}>Widerrufen<span className="sr-only">: {device.name}</span></button></article>)}</div>
    {devices.length === 0 && <p className="setting-control">Noch keine Geräte gekoppelt. Die Liste zeigt erfolgreich eingelöste Kopplungen.</p>}
  </section>;
}
