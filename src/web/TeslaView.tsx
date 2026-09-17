import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { WidgetSummary } from '../shared/types.js';
import { ApiError, dateTime, errorMessage, forecastRemaining, getJSON, km, preciseKm, sendJSON } from './api.js';
import { Appearance } from './Experience.js';

interface Pairing { code: string; secret: string; expiresAt: number; approvalUrl: string }
const snapshotKey = 'lease-tesla-summary';
export function TeslaView() {
  const [data, setData] = useState<WidgetSummary | null>(null);
  const [pair, setPair] = useState<Pairing | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [needsPairing, setNeedsPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true);
    try {
      const summary = await getJSON<WidgetSummary>('/api/widget-summary');
      setData(summary); setError(null); setNeedsPairing(false); localStorage.setItem(snapshotKey, JSON.stringify(summary));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { localStorage.removeItem(snapshotKey); setData(null); setNeedsPairing(true); setError(cause.message); }
      else {
        setError(`Verbindung unterbrochen · letzter gespeicherter Stand. ${errorMessage(cause)}`);
        const saved = localStorage.getItem(snapshotKey);
        if (saved) { try { const value = JSON.parse(saved) as WidgetSummary; if (value.version === 1) setData(value); } catch { localStorage.removeItem(snapshotKey); } }
      }
    } finally { inFlight.current = false; setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh); window.addEventListener('online', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, [load]);
  useEffect(() => {
    if (!pair) return;
    let alive = true; let requesting = false;
    const timer = setInterval(() => {
      if (requesting || document.visibilityState !== 'visible') return;
      if (Date.now() >= pair.expiresAt) { setPair(null); setError('Kopplung abgelaufen. Bitte neu starten.'); return; }
      requesting = true;
      void sendJSON<{ pending: boolean }>('/api/pairing/claim', 'POST', { code: pair.code, secret: pair.secret }).then(result => {
        if (alive && !result.pending) { setPair(null); void load(); }
      }).catch(cause => { if (alive) { setError(errorMessage(cause)); if (cause instanceof ApiError && cause.status < 500 && cause.status !== 429) setPair(null); } }).finally(() => { requesting = false; });
    }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [pair, load]);
  const startPairing = async () => {
    setLoading(true); setError(null);
    try { const result = await sendJSON<Pairing>('/api/pairing/tesla', 'POST', {}); setQr(await QRCode.toDataURL(result.approvalUrl, { width: 260, margin: 2 })); setPair(result); }
    catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  };
  return <main className="tesla-view"><header className="tesla-header"><a className="brand" href="/tesla"><img src="/icon.svg" alt=""/>Lease Tracker</a><span>Schnellblick im Stand</span><button className="button secondary" disabled={loading} onClick={() => void load()}>Aktualisieren</button></header>
    {error && <div className="alert warning" role="alert">{error}</div>}
    {needsPairing ? <section className="card pairing-screen"><h1>Dein Kilometerbudget im Tesla.</h1><p>Einmal mit dem Smartphone freigeben. Danach genügt dieses Lesezeichen.</p>{pair && qr ? <div className="qr-pair"><img src={qr} alt="QR-Code zur Freigabe auf deinem Smartphone"/><div><h2>{pair.code}</h2><p>Scanne den QR-Code, melde dich an und bestätige diesen Code. Zehn Minuten gültig.</p></div></div> : <button className="button primary" disabled={loading} onClick={() => void startPairing()}>Mit Smartphone koppeln</button>}</section> : data ? <>
      {data.demo && <p className="demo-banner">Synthetische Beispieldaten</p>}
      <div className="tesla-grid"><section className="budget-card"><div className="section-label">VERBLEIBENDES KONTINGENT</div><div className="hero-number">{km(data.remainingKm)}<span>km</span></div><p>{data.ended ? 'Vertrag beendet · letzter bekannter Stand' : `${km(data.usedKm)} km verbraucht`}</p></section><section className="card"><div className="eyebrow">DEIN KURS</div><h2>{km(data.deviationKm === null ? null : Math.abs(data.deviationKm))} km</h2><p>{data.deviationKm === null ? 'Kilometerstand fehlt' : data.deviationKm > 0 ? 'über dem anteiligen Soll' : 'unter dem anteiligen Soll'}</p></section><section className="card"><div className="eyebrow">AM VERTRAGSENDE · {data.forecast?.label}</div><h2>{km(data.ended ? data.usedKm : data.forecast?.projectedKm ?? null)} km</h2><p>{data.ended ? 'Endergebnis nach bekanntem Stand' : data.forecast?.reason ?? forecastRemaining(data.forecast?.remainingKm ?? null)}</p></section><section className="card"><div className="eyebrow">LETZTE FAHRT</div><h2>{preciseKm(data.lastTrip?.distanceKm ?? null)} km</h2><p>{data.lastTrip?.reason ?? dateTime(data.lastTrip?.end ?? null, data.timeZone)}</p></section></div>
      {(data.quality.gaps > 0 || data.quality.incompleteTrips > 0) && <p className="alert warning">{data.quality.gaps} Datenlücken · {data.quality.incompleteTrips} offene / unvollständige Fahrten · {preciseKm(data.quality.unassignedKm)} km nicht zugeordnet</p>}
      <p className="tesla-timestamps">Fahrzeugdaten: {dateTime(data.odometerAt, data.timeZone)}<br/>Berechnet: {dateTime(data.asOf, data.timeZone)}</p>
    </> : <p role="status">{loading ? 'Daten werden geladen …' : 'Keine gespeicherten Daten. Verbindung prüfen und aktualisieren.'}</p>}
    <details className="tesla-appearance"><summary>Darstellung</summary><Appearance/></details>
  </main>;
}
