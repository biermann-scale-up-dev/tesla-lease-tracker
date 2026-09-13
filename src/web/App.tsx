import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, ArrowRight, ChartNoAxesCombined, Check, CircleHelp, Gauge, LayoutDashboard, LogOut, RefreshCw, Route, Settings2, ShieldCheck, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Contract, DailyDistance, Dashboard, Summary, Trip } from '../shared/types.js';
import { addDays, contractYear, localDate } from '../shared/dates.js';
import { dateTime, errorMessage, getJSON, km, preciseKm, sendJSON } from './api.js';
import { Settings } from './Settings.js';

type Page = 'overview' | 'trips' | 'settings';
const colors = ['#306e5a', '#c39332', '#7774c1', '#59666d'];

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(location.hash === '#settings' ? 'settings' : 'overview');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setDashboard(await getJSON<Dashboard>('/api/dashboard')); setError(null); }
    catch (error) { setError(errorMessage(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    getJSON<{ authenticated: boolean }>('/api/session').then(result => setAuthenticated(result.authenticated)).catch(error => setError(errorMessage(error)));
    const expired = () => { setAuthenticated(false); setDashboard(null); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  useEffect(() => { if (authenticated) void load(); }, [authenticated, load]);
  useEffect(() => {
    const refresh = () => { if (authenticated && document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [authenticated, load]);
  if (authenticated !== true) return <Login ready={authenticated === false} problem={error} onLogin={() => setAuthenticated(true)} />;
  const navigate = (next: Page) => { setPage(next); location.hash = next; };
  const connected = dashboard?.tesla.synced && dashboard.service.broker === 'connected' && dashboard.service.receiver === 'connected';
  return <div className="app-shell">
    <a className="skip-link" href="#content">Zum Inhalt</a>
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={() => navigate('overview')}><img src="/icon.svg" alt="" /><span>lease<span className="brand-light">tracker</span><small>TESLA EDITION</small></span></a>
      <div className="nav-label">DEIN COCKPIT</div>
      <nav aria-label="Hauptnavigation">
        <button className={page === 'overview' ? 'active' : ''} onClick={() => navigate('overview')}><LayoutDashboard size={19} /><span>Übersicht</span></button>
        <button className={page === 'trips' ? 'active' : ''} onClick={() => navigate('trips')}><Route size={19} /><span>Fahrten</span></button>
        <button className={page === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><Settings2 size={19} /><span>Vertrag & Verbindung</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="private-note"><ShieldCheck size={20}/><strong>Deine Daten bleiben bei dir.</strong><p>Selbst gehostet. Open Source.<br/>Für deine nächste Fahrt.</p></div><span className="version">v0.1.0 · MIT License</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><span className="crumb">Mein Fahrzeug</span><span className="slash">/</span><strong>{dashboard?.tesla.vehicle?.name ?? 'Tesla verbinden'}</strong></div><div className="topbar-actions"><span className={`connection ${connected ? 'good' : ''}`}><i/>{dashboard?.demo ? 'Demodaten' : connected ? 'Erfassung aktiv' : 'Verbindung prüfen'}</span><button className="icon-button" aria-label="Abmelden" onClick={() => { sendJSON('/api/logout', 'POST', {}).then(() => { setAuthenticated(false); setDashboard(null); }).catch(error => setError(errorMessage(error))); }}><LogOut size={18}/></button></div></header>
      <main id="content">
        {dashboard?.demo && <div className="demo-banner"><CircleHelp size={16}/> Synthetische Beispieldaten · kein Fahrzeug verbunden</div>}
        {error && <div className="alert error" role="alert">{error}</div>}
        {!dashboard ? <p role="status">Dein Dashboard wird geladen …</p> : page === 'settings' ? <Settings dashboard={dashboard} reload={load} /> : <>
          <div className="page-heading"><div><div className="eyebrow">{page === 'overview' ? 'ENTSPANNT IM KILOMETERBUDGET' : 'AUTOMATISCH FESTGEHALTEN'}</div><h1>{page === 'overview' ? 'Deine Kilometer im Blick.' : 'Jede Fahrt zählt.'}</h1><p>{page === 'overview' ? 'Heute wissen, wo du am Vertragsende ankommst.' : 'Vom Losfahren bis zum Parken. Ohne einen Knopfdruck.'}</p></div><button className="button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'spin' : ''}/>Aktualisieren</button></div>
          {!dashboard.contract ? <section className="empty card"><Gauge size={40}/><h2>Dein Kilometerbudget beginnt hier.</h2><p>Hinterlege deinen Leasingvertrag und verbinde deinen Tesla.</p><button className="button primary" onClick={() => navigate('settings')}>Jetzt einrichten <ArrowRight size={17}/></button></section> : dashboard.summary && <>
            <ConnectionNotice dashboard={dashboard}/>
            {page === 'overview' ? <Overview dashboard={dashboard} summary={dashboard.summary} contract={dashboard.contract} reload={load} navigate={navigate}/> : <TripTable trips={dashboard.summary.trips} timeZone={dashboard.contract.timeZone} />}
          </>}
        </>}
        <footer>Lease Tracker <span>Ein unabhängiges Open-Source-Projekt. Nicht mit Tesla verbunden.</span></footer>
      </main>
    </div>
  </div>;
}
function Login({ ready, problem, onLogin }: { ready: boolean; problem: string | null; onLogin: () => void }) {
  const [password, setPassword] = useState(''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await sendJSON('/api/login', 'POST', { password }); onLogin(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } };
  return <div className="login-page"><div className="login-art"><img src="/icon.svg" alt=""/><div className="eyebrow">WENIGER RECHNEN. WEITER DENKEN.</div><h1>Deine Kilometer.<br/>Dein Überblick.</h1><p>Ein klarer Blick auf deinen Leasingvertrag.<br/>Damit am Ende nur gute Überraschungen bleiben.</p><div className="road-art" aria-hidden="true"><span/><span/><span/></div></div><div className="login-panel"><form onSubmit={event => void submit(event)}><div className="eyebrow">WILLKOMMEN ZURÜCK</div><h2>Dein persönliches Cockpit.</h2><p>Melde dich mit deinem App-Passwort an.</p>{(error || problem) && <div className="alert error" role="alert">{error || problem}</div>}<label>App-Passwort<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)}/></label><button className="button primary wide" disabled={!ready || busy}>{busy ? 'Anmelden …' : 'Anmelden'}<ArrowRight size={18}/></button><small>Das App-Passwort wird beim Einrichten deines Servers vergeben. Dein Tesla-Passwort gibst du ausschließlich bei Tesla ein.</small></form></div></div>;
}
function ConnectionNotice({ dashboard }: { dashboard: Dashboard }) {
  if (dashboard.demo) return null;
  const service = dashboard.service;
  const messages = [dashboard.tesla.problem, service.problem, service.receiver === 'error' ? 'Telemetrie-Empfänger nicht erreichbar. Server prüfen.' : null, service.receiver === 'unchecked' ? 'Empfängerstatus nicht eingerichtet.' : null, service.rejectedRecords > 0 ? `${service.rejectedRecords} Datensätze konnten nicht verarbeitet werden. Serverprotokoll prüfen.` : null].filter(Boolean);
  if (!dashboard.tesla.synced && messages.length === 0) messages.push('Die automatische Erfassung ist noch nicht vollständig eingerichtet.');
  return <><div className="data-note"><Activity size={15}/>Empfänger: {service.receiver === 'connected' ? 'erreichbar' : service.receiver === 'error' ? 'ausgefallen' : 'ungeprüft'} · Broker: {service.broker === 'connected' ? 'verbunden' : service.broker === 'error' ? 'ausgefallen' : 'nicht verbunden'} · Fahrzeug: {service.vehicleConnectivity === 'CONNECTED' ? 'verbunden' : service.vehicleConnectivity === 'DISCONNECTED' ? 'getrennt (Schlaf oder Verbindungspause)' : 'noch kein Verbindungsereignis'} · Letztes Signal: {dateTime(service.lastMessageAt, dashboard.contract?.timeZone ?? 'Europe/Berlin')}</div>{messages.length > 0 && <div className="alert warning">{messages.join(' ')}</div>}</>;
}
function Overview({ dashboard, summary: s, contract, reload, navigate }: { dashboard: Dashboard; summary: Summary; contract: Contract; reload: () => Promise<void>; navigate: (page: Page) => void }) {
  const usedPercent = Math.max(0, Math.min(100, (s.usedKm ?? 0) / contract.totalKm * 100));
  const over = (s.deviationKm ?? 0) > 0;
  const recent = s.daily.slice(-7);
  const today = localDate(s.asOf, contract.timeZone);
  const todayTrips = s.trips.filter(trip => trip.end && localDate(trip.end, contract.timeZone) === today);
  return <>
    <div className="hero-grid"><section className="budget-card"><div className="card-top"><span>DEIN VERBLEIBENDES KONTINGENT</span><Gauge size={22}/></div><div className="hero-number">{km(s.remainingKm)}<span>km</span></div><p>{s.ended ? 'Vertrag beendet · letzter bekannter Stand' : `bis zum ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${contract.endDate}T00:00:00Z`))}`}</p><div className="budget-track"><div style={{ width: `${usedPercent}%` }}/><i style={{ left: `${s.elapsedDays / s.totalDays * 100}%` }}/></div><div className="budget-labels"><span>{km(s.usedKm)} km gefahren</span><span>{km(contract.totalKm)} km vereinbart</span></div><div className="budget-bottom"><span className="budget-pill">{s.ended ? 'Vertragsende erreicht' : `${s.remainingDays} Tage verbleiben`}</span><span>Markierung = anteiliges Soll</span></div></section>
    <section className="card pace-card"><div className="section-label"><Activity size={17}/> DEIN AKTUELLER KURS</div><span className={`status-pill ${over ? 'amber' : 'green'}`}>{s.usedKm === null ? 'Warte auf Kilometerstand' : over ? 'Über dem Soll' : 'Unter dem Soll'}</span><h2>{km(s.deviationKm === null ? null : Math.abs(s.deviationKm))}<span> km {over ? 'mehr' : 'Puffer'}</span></h2><p>{over ? 'Du bist bisher mehr gefahren als zeitanteilig vorgesehen.' : 'So viel weniger bist du bisher gefahren als zeitanteilig vorgesehen.'}</p><div className="pace-detail"><span>Dein anteiliges Soll</span><strong>{km(s.allowedKm)} km</strong></div><div className="pace-detail"><span>Ab jetzt im Tagesdurchschnitt</span><strong>{km(s.dailyBudgetKm)} km / Tag</strong></div></section></div>
    <div className="stat-grid"><Stat icon={<Route size={19}/>} label="Heute erfasst" value={preciseKm(todayTrips.reduce((sum, trip) => sum + (trip.distanceKm ?? 0), 0))} unit="km" detail={`${todayTrips.length} Fahrten · laufender Tag`}/><Stat icon={<ChartNoAxesCombined size={19}/>} label="Letzte 7 Tage" value={recent.length === 7 && recent.every(day => day.complete) ? preciseKm(recent.reduce((sum, day) => sum + (day.distanceKm ?? 0), 0)) : null} unit="km" detail={`${recent.filter(day => day.complete).length}/7 Tage vollständig`}/><Stat icon={<Gauge size={19}/>} label="Kilometerstand" value={km(s.odometerKm)} unit="km" detail={dateTime(s.odometerAt, contract.timeZone)}/><Stat icon={<ShieldCheck size={19}/>} label="Fahrten erfasst" value={String(s.trips.filter(trip => trip.status === 'complete').length)} unit="" detail={`${s.trips.filter(trip => trip.status !== 'complete').length} offen / unvollständig`}/></div>
    <ForecastPanel dashboard={dashboard} summary={s} contract={contract} reload={reload}/>
    <div className="lower-grid"><History daily={s.daily} contract={contract}/><section className="card recent-trips"><div className="section-heading"><div><div className="eyebrow">UNTERWEGS</div><h2>Deine letzten Fahrten</h2></div><button className="text-button" onClick={() => navigate('trips')}>Alle <ArrowRight size={15}/></button></div>{s.trips.slice(0, 4).map(trip => <div className="trip-line" key={trip.id}><span className="trip-icon"><Route size={18}/></span><div><strong>{dateTime(trip.start, contract.timeZone)}</strong><small>{trip.status === 'complete' ? `${Math.round((Date.parse(trip.end!) - Date.parse(trip.start)) / 60_000)} Minuten · abgeschlossen` : trip.reason ?? 'Fahrt läuft'}</small></div><strong>{preciseKm(trip.distanceKm)} <small>km</small></strong></div>)}{s.trips.length === 0 && <p>Deine erste Fahrt erscheint nach dem Parken.</p>}</section></div>
    {s.gaps.length > 0 && <div className="alert warning"><strong>Datenqualität:</strong> {s.gaps.length} unvollständige Abschnitte · {preciseKm(s.unassignedKm)} km nicht zugeordnet. Betroffene Zeiträume fließen nicht in die Kurzfristprognosen ein.</div>}
    <div className="data-note"><ShieldCheck size={15}/> Erfasst seit {dateTime(s.trackingSince, contract.timeZone)}. Fahrtkilometer zählen zum Ankunftstag. Stille Tage gelten erst nach einem weiteren Kilometerstand als belegt.</div>
  </>;
}
function Stat({ icon, label, value, unit, detail }: { icon: React.ReactNode; label: string; value: string | null; unit: string; detail: string }) { return <section className="card stat"><div className="stat-label">{icon}{label}</div><div className="stat-value">{value ?? '—'} <span>{unit}</span></div><small>{detail}</small></section>; }

function ForecastPanel({ dashboard, summary: s, contract, reload }: { dashboard: Dashboard; summary: Summary; contract: Contract; reload: () => Promise<void> }) {
  const [windows, setWindows] = useState(dashboard.preferences.windows); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const today = localDate(s.asOf, contract.timeZone);
  const points = Array.from({ length: 13 }, (_, index) => {
    const fraction = index / 12;
    return { date: addDays(today, Math.round(s.remainingDays * fraction)), budget: s.allowedKm + (contract.totalKm - s.allowedKm) * fraction, ...Object.fromEntries(s.forecasts.map(forecast => [forecast.id, forecast.projectedKm === null || s.usedKm === null ? null : s.usedKm + (forecast.projectedKm - s.usedKm) * fraction])) };
  });
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await sendJSON('/api/preferences', 'PUT', { windows }); setError(null); await reload(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } };
  return <section className="card forecast-panel"><div className="section-heading"><div><div className="eyebrow">VORAUSSCHAUEN STATT SCHÄTZEN</div><h2>Wo kommst du am Ende an?</h2><p>Vergleiche dein Fahrverhalten. Alle Prognosen auf einen Blick.</p></div><span className="subtle-tag">{s.ended ? 'Vertrag beendet' : 'Bis Vertragsende'}</span></div>
    <form className="window-form" onSubmit={event => void save(event)}><span>Vergleichszeiträume</span>{windows.map((value, index) => <label key={index}><input aria-label={`Prognosezeitraum ${index + 1}`} type="number" min={1} max={365} required value={Number.isNaN(value) ? '' : value} onChange={event => setWindows(previous => previous.map((item, at) => at === index ? event.target.valueAsNumber : item) as [number, number, number])}/><span>Tage</span></label>)}<button className="button compact secondary" disabled={busy}><Check size={15}/>Übernehmen</button></form>{error && <div className="alert error" role="alert">{error}</div>}
    {!s.ended && <div className="forecast-chart" role="img" aria-label="Prognosevergleich der gefahrenen Vertragskilometer bis Vertragsende. Exakte Werte stehen in der folgenden Tabelle."><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 20, right: 24, bottom: 5, left: 5 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e6e9e2"/><XAxis dataKey="date" tickFormatter={date => new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${String(date)}T00:00:00Z`))} minTickGap={60} axisLine={false} tickLine={false} tick={{ fill: '#77817a', fontSize: 11 }}/><YAxis tickFormatter={value => `${km(Number(value) / 1000)}k`} axisLine={false} tickLine={false} tick={{ fill: '#77817a', fontSize: 11 }}/><Tooltip formatter={value => `${km(Number(value))} km`} labelFormatter={date => String(date)}/><ReferenceLine y={contract.totalKm} stroke="#c9b68b" strokeDasharray="5 5"/><Line type="linear" name="Anteiliges Soll" dataKey="budget" stroke="#b6beb5" strokeDasharray="5 5" dot={false} strokeWidth={2}/>{s.forecasts.map((forecast, index) => <Line key={forecast.id} name={forecast.label} dataKey={forecast.id} stroke={colors[index]} dot={false} strokeWidth={2.5} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>}
    <div className="table-wrap"><table className="forecast-table"><thead><tr><th>Berechnungsgrundlage</th><th>Ø pro Tag</th><th>Am Vertragsende</th><th>Rest / Mehrkilometer</th></tr></thead><tbody>{s.forecasts.map((forecast, index) => <tr key={forecast.id}><td><span className="legend-dot" style={{ background: colors[index] }}/><strong>{forecast.label}</strong>{forecast.reason && <small>{forecast.reason}</small>}</td><td>{preciseKm(forecast.dailyKm)} <span>km</span></td><td><strong>{km(forecast.projectedKm)}</strong> <span>km</span></td><td className={forecast.remainingKm !== null && forecast.remainingKm < 0 ? 'text-amber' : 'text-green'}>{forecast.remainingKm === null ? '—' : <><span className="inline-icon">{forecast.remainingKm < 0 ? <ArrowUpRight size={16}/> : <ArrowDownRight size={16}/>}</span>{km(Math.abs(forecast.remainingKm))} km {forecast.remainingKm < 0 ? 'zu viel' : 'übrig'}</>}</td></tr>)}</tbody></table></div><div className="chart-caption"><CircleHelp size={14}/> Lineare Hochrechnung, keine Vorhersage deiner tatsächlichen Fahrten. Unvollständige Zeiträume werden nicht hochgerechnet.</div>
  </section>;
}
function History({ daily, contract }: { daily: DailyDistance[]; contract: Contract }) {
  const [period, setPeriod] = useState('daily');
  const grouped = new Map<string, { label: string; km: number; complete: boolean }>();
  for (const day of daily) {
    const label = period === 'monthly' ? day.date.slice(0, 7) : period === 'yearly' ? `Jahr ${contractYear(day.date, contract.startDate)}` : day.date;
    const previous = grouped.get(label);
    grouped.set(label, { label, km: (previous?.km ?? 0) + day.recordedKm, complete: (previous?.complete ?? true) && day.complete });
  }
  const data = [...grouped.values()].slice(period === 'weekly' ? -7 : period === 'daily' ? -14 : -12);
  return <section className="card history-card"><div className="section-heading"><div><div className="eyebrow">DEIN FAHRVERHALTEN</div><h2>Kilometer im Verlauf</h2></div><select aria-label="Zeitraum der Kilometer-Auswertung" value={period} onChange={event => setPeriod(event.target.value)}><option value="daily">Täglich</option><option value="weekly">7 Tage</option><option value="monthly">Monatlich</option><option value="yearly">Vertragsjahr</option></select></div><div className="history-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e6e9e2"/><XAxis dataKey="label" tickFormatter={label => String(label).length === 10 ? String(label).slice(8) : String(label)} tickLine={false} axisLine={false} tick={{ fill: '#77817a', fontSize: 10 }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#77817a', fontSize: 10 }} width={35}/><Tooltip formatter={value => `${preciseKm(Number(value))} km erfasst`}/><Bar dataKey="km" name="Erfasste Kilometer" fill="#b6cda4" radius={[4, 4, 0, 0]} maxBarSize={30}/></BarChart></ResponsiveContainer></div><p className="chart-caption">Erfasste Kilometer. {data.some(item => !item.complete) ? 'Enthält unvollständige Zeiträume; fehlende Kilometer sind unbekannt.' : 'Alle angezeigten Tage sind vollständig belegt.'}</p></section>;
}
export function TripTable({ trips, timeZone }: { trips: Trip[]; timeZone: string }) {
  return <section className="card"><div className="section-heading"><h2>Fahrtenbuch</h2><span className="subtle-tag">{trips.length} Fahrten</span></div><div className="table-wrap"><table><thead><tr><th>Start</th><th>Ende</th><th>Startstand</th><th>Endstand</th><th>Strecke</th><th>Status</th></tr></thead><tbody>{trips.map(trip => <tr key={trip.id}><td>{dateTime(trip.start, timeZone)}</td><td>{trip.end ? dateTime(trip.end, timeZone) : '—'}</td><td>{preciseKm(trip.startKm)} km</td><td>{preciseKm(trip.endKm)} km</td><td><strong>{preciseKm(trip.distanceKm)} km</strong></td><td><span className={`status-pill ${trip.status === 'complete' ? 'green' : 'amber'}`}>{trip.status === 'complete' ? 'Vollständig' : trip.status === 'open' ? 'Unterwegs' : 'Unvollständig'}</span>{trip.reason && <small>{trip.reason}</small>}</td></tr>)}</tbody></table>{trips.length === 0 && <div className="empty"><Zap size={30}/><p>Noch keine Fahrten erfasst. Nach der Einrichtung funktioniert das automatisch.</p></div>}</div></section>;
}
