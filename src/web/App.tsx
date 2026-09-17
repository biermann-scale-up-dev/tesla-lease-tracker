import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, ArrowRight, ChartNoAxesCombined, Check, CircleHelp, Gauge, LayoutDashboard, LogOut, RefreshCw, Route, Settings2, ShieldCheck, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DisplayContract, DailyDistance, Dashboard, ForecastBasis, Preferences, Summary, Trip } from '../shared/types.js';
import { addDays, contractYear, localDate } from '../shared/dates.js';
import { dateTime, errorMessage, forecastRemaining, km, preciseKm, sendJSON } from './api.js';
import { Settings } from './Settings.js';
import { useOwner } from './useOwner.js';
import { Appearance, Installation, useDirty } from './Experience.js';
import { DeviceSettingsPanel } from './Devices.js';
import { forecastBasisSchema } from '../shared/types.js';
import { logoutKey } from './offline.js';
import { version } from '../../package.json';

type Page = 'overview' | 'trips' | 'analytics' | 'settings';
const colors = ['var(--line-1)', 'var(--line-2)', 'var(--line-3)', 'var(--line-4)'];

function currentPage(): Page {
  const page = location.hash.slice(1).split('?')[0];
  return page === 'trips' || page === 'settings' || page === 'analytics' ? page : 'overview';
}
export function App() {
  const { authenticated, dashboard, snapshot, error, loading, load, logout } = useOwner();
  const [page, setPage] = useState<Page>(currentPage);
  const [basis, setBasis] = useState<ForecastBasis>(() => forecastBasisSchema.parse(localStorage.getItem('lease-forecast') ?? 'window-1'));
  useEffect(() => {
    const navigate = () => { setPage(currentPage()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', navigate); return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const navigate = (next: Page) => { location.hash = next; };
  const view = dashboard ?? snapshot;
  if (authenticated !== true) return <Login ready={authenticated === false && !loading} problem={error} onLogin={() => { void load(); }} />;
  const offline = snapshot !== null;
  return <div className="app-shell">
    <a className="skip-link" href="#content" onClick={event => { event.preventDefault(); document.getElementById('content')?.focus(); }}>Zum Inhalt</a>
    <aside className="sidebar">
      <a className="brand" href="#overview"><img src="/icon.svg" alt=""/><span>lease<span className="brand-light">tracker</span><small>TESLA EDITION</small></span></a>
      <div className="nav-label">DEIN COCKPIT</div>
      <nav aria-label="Hauptnavigation">{([
        ['overview', 'Übersicht', LayoutDashboard], ['trips', 'Fahrten', Route],
        ['analytics', 'Auswertungen', ChartNoAxesCombined], ['settings', 'Einstellungen', Settings2],
      ] as const).map(([id, label, Icon]) => <a key={id} href={`#${id}`} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined}><Icon size={22}/><span>{label}</span></a>)}</nav>
      <div className="sidebar-bottom"><div className="private-note"><ShieldCheck size={20}/><strong>Deine Daten bleiben bei dir.</strong><p>Selbst gehostet. Open Source.</p></div><span className="version">v{version} · MIT License</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><strong>{dashboard?.tesla.vehicle?.name ?? 'Lease Tracker'}</strong><div className="topbar-actions"><span className="connection">{offline ? 'Offline-Datenstand' : view?.demo ? 'Demodaten' : 'Dein Kilometerbudget'}</span><button className="icon-button" aria-label="Abmelden" onClick={() => void logout()}><LogOut size={20}/></button></div></header>
      <main id="content" tabIndex={-1}>
        {view?.demo && <div className="demo-banner"><CircleHelp size={16}/> Synthetische Beispieldaten · kein Fahrzeug verbunden</div>}
        {error && <div className="alert warning" role="alert">{error}</div>}
        {offline && <div className="alert warning" role="status">Offline · Gespeichert am {dateTime(snapshot.savedAt, snapshot.contract?.timeZone ?? 'Europe/Berlin')}. Änderungen benötigen eine Verbindung. Fahrten: letzte 20 gespeicherte Einträge.</div>}
        {!view ? <p role="status">Dein Dashboard wird geladen …</p> : <>
          <div className="page-heading"><div><div className="eyebrow">DEIN LEASING. DEIN ÜBERBLICK.</div><h1>{page === 'overview' ? 'Deine Kilometer im Blick.' : page === 'trips' ? 'Jede Fahrt zählt.' : page === 'analytics' ? 'Dein Kurs bis zur Rückgabe.' : 'Alles an einem Ort.'}</h1></div><button className="button secondary" disabled={loading} onClick={() => void load()} aria-label="Aktualisieren"><RefreshCw size={18} className={loading ? 'spin' : ''}/><span>Aktualisieren</span></button></div>
          {page === 'settings' ? <><div className="settings-grid app-settings"><Appearance/><Installation/></div>{dashboard ? <><DeviceSettingsPanel forecasts={dashboard.summary?.forecasts ?? []}/><Settings dashboard={dashboard} reload={load}/></> : <p className="card">Vertrag, Tesla-Verbindung und Geräteverwaltung sind online verfügbar.</p>}</> : !view.contract ? <section className="empty card"><Gauge size={40}/><h2>Dein Kilometerbudget beginnt hier.</h2><p>Hinterlege deinen Leasingvertrag und verbinde deinen Tesla.</p><button className="button primary" onClick={() => navigate('settings')}>Jetzt einrichten <ArrowRight size={17}/></button></section> : view.summary && <>
            {dashboard && <ConnectionNotice dashboard={dashboard}/>}
            {page === 'overview' ? <Overview summary={view.summary} contract={view.contract} navigate={navigate} basis={basis} setBasis={value => { setBasis(value); localStorage.setItem('lease-forecast', value); }}/>
              : page === 'analytics' ? <><SummaryStats summary={view.summary} timeZone={view.contract.timeZone}/><ForecastPanel preferences={view.preferences} summary={view.summary} contract={view.contract} reload={load} offline={offline}/><History daily={view.summary.daily} contract={view.contract}/></>
              : <TripTable trips={view.summary.trips} timeZone={view.contract.timeZone}/>}
            <div className="data-note">Berechnet: {dateTime(view.summary.asOf, view.contract.timeZone)} · Fahrzeugdaten: {dateTime(view.summary.odometerAt, view.contract.timeZone)}</div>
          </>}
        </>}
        <footer>Lease Tracker <span>Unabhängiges Open-Source-Projekt. Nicht mit Tesla verbunden.</span></footer>
      </main>
    </div>
  </div>;
}
function Login({ ready, problem, onLogin }: { ready: boolean; problem: string | null; onLogin: () => void }) {
  const [password, setPassword] = useState(''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { if (localStorage.getItem(logoutKey)) { await sendJSON('/api/logout', 'POST', {}); localStorage.removeItem(logoutKey); } await sendJSON('/api/login', 'POST', { password }); onLogin(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } };
  return <div className="login-page"><div className="login-art"><img src="/icon.svg" alt=""/><div className="eyebrow">WENIGER RECHNEN. WEITER DENKEN.</div><h1>Deine Kilometer.<br/>Dein Überblick.</h1><p>Ein klarer Blick auf deinen Leasingvertrag.<br/>Damit am Ende nur gute Überraschungen bleiben.</p><div className="road-art" aria-hidden="true"><span/><span/><span/></div></div><div className="login-panel"><form onSubmit={event => void submit(event)}><div className="eyebrow">WILLKOMMEN ZURÜCK</div><h2>Dein persönliches Cockpit.</h2><p>Melde dich mit deinem App-Passwort an.</p>{(error || problem) && <div className="alert error" role="alert">{error || problem}</div>}<label>App-Passwort<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)}/></label><button className="button primary wide" disabled={!ready || busy}>{busy ? 'Anmelden …' : 'Anmelden'}<ArrowRight size={18}/></button><small>Das App-Passwort wird beim Einrichten deines Servers vergeben. Dein Tesla-Passwort gibst du ausschließlich bei Tesla ein.</small></form></div></div>;
}
function ConnectionNotice({ dashboard }: { dashboard: Dashboard }) {
  if (dashboard.demo) return null;
  const service = dashboard.service;
  const messages = [dashboard.tesla.problem, service.problem, service.receiver === 'error' ? 'Telemetrie-Empfänger nicht erreichbar. Server prüfen.' : null, service.receiver === 'unchecked' ? 'Empfängerstatus nicht eingerichtet.' : null, service.rejectedRecords > 0 ? `${service.rejectedRecords} Datensätze konnten nicht verarbeitet werden. Serverprotokoll prüfen.` : null].filter(Boolean);
  if (!dashboard.tesla.synced && messages.length === 0) messages.push('Die automatische Erfassung ist noch nicht vollständig eingerichtet.');
  return <><details className="diagnostics"><summary>Erfassungsstatus und Diagnose</summary><div className="data-note"><Activity size={15}/>Empfänger: {service.receiver === 'connected' ? 'erreichbar' : service.receiver === 'error' ? 'ausgefallen' : 'ungeprüft'} · Broker: {service.broker === 'connected' ? 'verbunden' : service.broker === 'error' ? 'ausgefallen' : 'nicht verbunden'} · Fahrzeug: {service.vehicleConnectivity === 'CONNECTED' ? 'verbunden' : service.vehicleConnectivity === 'DISCONNECTED' ? 'getrennt (Schlaf oder Verbindungspause)' : 'noch kein Verbindungsereignis'} · Letztes Signal: {dateTime(service.lastMessageAt, dashboard.contract?.timeZone ?? 'Europe/Berlin')}</div></details>{messages.length > 0 && <div className="alert warning">{messages.join(' ')}</div>}</>;
}
function Overview({ summary: s, contract, navigate, basis, setBasis }: { summary: Summary; contract: DisplayContract; navigate: (page: Page) => void; basis: ForecastBasis; setBasis: (value: ForecastBasis) => void }) {
  const forecast = s.forecasts.find(item => item.id === basis);
  const usedPercent = Math.max(0, Math.min(100, (s.usedKm ?? 0) / contract.totalKm * 100));
  const over = (s.deviationKm ?? 0) > 0;
  return <>
    <div className="hero-grid"><section className="budget-card"><div className="card-top"><span>DEIN VERBLEIBENDES KONTINGENT</span><Gauge size={22}/></div><div className="hero-number">{km(s.remainingKm)}<span>km</span></div><p>{s.ended ? 'Vertrag beendet · letzter bekannter Stand' : `bis zum ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${contract.endDate}T00:00:00Z`))}`}</p><div className="budget-track"><div style={{ width: `${usedPercent}%` }}/><i style={{ left: `${s.elapsedDays / s.totalDays * 100}%` }}/></div><div className="budget-labels"><span>{km(s.usedKm)} km gefahren</span><span>{km(contract.totalKm)} km vereinbart</span></div><div className="budget-bottom"><span className="budget-pill">{s.ended ? 'Vertragsende erreicht' : `${s.remainingDays} Tage verbleiben`}</span><span>Markierung = anteiliges Soll</span></div></section>
    <section className="card pace-card"><div className="section-label"><Activity size={17}/> DEIN AKTUELLER KURS</div><span className={`status-pill ${over ? 'amber' : 'green'}`}>{s.usedKm === null ? 'Warte auf Kilometerstand' : over ? 'Über dem Soll' : 'Unter dem Soll'}</span><h2>{km(s.deviationKm === null ? null : Math.abs(s.deviationKm))}<span> km {over ? 'mehr' : 'Puffer'}</span></h2><p>{s.deviationKm === null ? 'Sobald ein gültiger Kilometerstand vorliegt, siehst du hier deine Abweichung vom Soll.' : over ? 'Du bist bisher mehr gefahren als zeitanteilig vorgesehen.' : 'So viel weniger bist du bisher gefahren als zeitanteilig vorgesehen.'}</p><div className="pace-detail"><span>Dein anteiliges Soll</span><strong>{km(s.allowedKm)} km</strong></div><div className="pace-detail"><span>Ab jetzt im Tagesdurchschnitt</span><strong>{km(s.dailyBudgetKm)} km / Tag</strong></div></section></div>

    <section className="card overview-forecast"><div><div className="eyebrow">AM VERTRAGSENDE</div><h2>{s.ended ? `${km(s.usedKm)} km gefahren` : `${km(forecast?.projectedKm ?? null)} km erwartet`}</h2><p>{s.ended ? 'Vertrag beendet · letzter bekannter Stand' : forecast?.reason ?? forecastRemaining(forecast?.remainingKm ?? null)}</p></div><label>Prognosegrundlage<select value={basis} onChange={event => setBasis(forecastBasisSchema.parse(event.target.value))}>{s.forecasts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><a className="text-button" href="#analytics">Alle Prognosen vergleichen <ArrowRight size={16}/></a></section>
    <div className="recent-grid"><section className="card recent-trips"><div className="section-heading"><div><div className="eyebrow">UNTERWEGS</div><h2>Deine letzte Fahrt</h2></div><button className="text-button" onClick={() => navigate('trips')}>Alle <ArrowRight size={15}/></button></div>{s.trips.slice(0, 1).map(trip => <div className="trip-line" key={trip.id}><span className="trip-icon"><Route size={18}/></span><div><strong>{dateTime(trip.start, contract.timeZone)}</strong><small>{trip.status === 'complete' ? `${Math.round((Date.parse(trip.end!) - Date.parse(trip.start)) / 60_000)} Minuten · abgeschlossen` : trip.reason ?? 'Fahrt läuft'}</small></div><strong>{preciseKm(trip.distanceKm)} <small>km</small></strong></div>)}{s.trips.length === 0 && <p>Deine erste Fahrt erscheint nach dem Parken.</p>}</section></div>
    {s.gaps.length > 0 && <div className="alert warning"><strong>Datenqualität:</strong> {s.gaps.length} unvollständige Abschnitte · {preciseKm(s.unassignedKm)} km nicht zugeordnet. Betroffene Zeiträume fließen nicht in die Kurzfristprognosen ein.</div>}
    <div className="data-note"><ShieldCheck size={15}/> Erfasst seit {dateTime(s.trackingSince, contract.timeZone)}. Fahrtkilometer zählen zum Ankunftstag. Stille Tage gelten erst nach einem weiteren Kilometerstand als belegt.</div>
  </>;
}
function SummaryStats({ summary: s, timeZone }: { summary: Summary; timeZone: string }) {
  const recent = s.daily.slice(-7);
  return (<div className="stat-grid"><Stat icon={<Route size={19}/>} label="Heute erfasst" value={preciseKm(s.totals.todayRecordedKm)} unit="km" detail={`${s.totals.todayTrips} Fahrten · laufender Tag`}/><Stat icon={<ChartNoAxesCombined size={19}/>} label="Letzte 7 Tage" value={recent.length === 7 && recent.every(day => day.complete) ? preciseKm(recent.reduce((sum, day) => sum + (day.distanceKm ?? 0), 0)) : null} unit="km" detail={`${recent.filter(day => day.complete).length}/7 Tage vollständig`}/><Stat icon={<Gauge size={19}/>} label="Kilometerstand" value={km(s.odometerKm)} unit="km" detail={dateTime(s.odometerAt, timeZone)}/><Stat icon={<ShieldCheck size={19}/>} label="Fahrten erfasst" value={String(s.totals.completeTrips)} unit="" detail={`${s.totals.incompleteTrips} offen / unvollständig`}/></div>);
}
function Stat({ icon, label, value, unit, detail }: { icon: React.ReactNode; label: string; value: string | null; unit: string; detail: string }) { return <section className="card stat"><div className="stat-label">{icon}{label}</div><div className="stat-value">{value ?? '—'} <span>{unit}</span></div><small>{detail}</small></section>; }

function ForecastPanel({ preferences, summary: s, contract, reload, offline }: { preferences: Preferences; summary: Summary; contract: DisplayContract; reload: () => Promise<void>; offline: boolean }) {
  const [windows, setWindows] = useState(preferences.windows); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useDirty('forecast', JSON.stringify(windows) !== JSON.stringify(preferences.windows));
  const today = localDate(s.asOf, contract.timeZone);
  const points = Array.from({ length: 13 }, (_, index) => {
    const fraction = index / 12;
    return { date: addDays(today, Math.round(s.remainingDays * fraction)), budget: s.allowedKm + (contract.totalKm - s.allowedKm) * fraction, ...Object.fromEntries(s.forecasts.map(forecast => [forecast.id, forecast.projectedKm === null || s.usedKm === null ? null : s.usedKm + (forecast.projectedKm - s.usedKm) * fraction])) };
  });
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await sendJSON('/api/preferences', 'PUT', { windows }); setError(null); await reload(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } };
  return <section className="card forecast-panel"><div className="section-heading"><div><div className="eyebrow">VORAUSSCHAUEN STATT SCHÄTZEN</div><h2>Wo kommst du am Ende an?</h2><p>Vergleiche dein Fahrverhalten. Alle Prognosen auf einen Blick.</p></div><span className="subtle-tag">{s.ended ? 'Vertrag beendet' : 'Bis Vertragsende'}</span></div>
    <fieldset disabled={offline} className="form-fieldset"><form className="window-form" onSubmit={event => void save(event)}><span>Vergleichszeiträume</span>{windows.map((value, index) => <label key={index}><input aria-label={`Prognosezeitraum ${index + 1}`} type="number" min={1} max={365} required value={Number.isNaN(value) ? '' : value} onChange={event => setWindows(previous => previous.map((item, at) => at === index ? event.target.valueAsNumber : item) as [number, number, number])}/><span>Tage</span></label>)}<button className="button compact secondary" disabled={busy}><Check size={15}/>Übernehmen</button></form></fieldset>{error && <div className="alert error" role="alert">{error}</div>}
    {!s.ended && <div className="forecast-chart" role="img" aria-label="Prognosevergleich der gefahrenen Vertragskilometer bis Vertragsende. Exakte Werte stehen in der folgenden Tabelle."><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 20, right: 24, bottom: 5, left: 5 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)"/><XAxis dataKey="date" tickFormatter={date => new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${String(date)}T00:00:00Z`))} minTickGap={60} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }}/><YAxis tickFormatter={value => `${km(Number(value) / 1000)}k`} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }}/><Tooltip formatter={value => `${km(Number(value))} km`} labelFormatter={date => String(date)}/><ReferenceLine y={contract.totalKm} stroke="#c9b68b" strokeDasharray="5 5"/><Line type="linear" name="Anteiliges Soll" dataKey="budget" stroke="#b6beb5" strokeDasharray="5 5" dot={false} strokeWidth={2}/>{s.forecasts.map((forecast, index) => <Line key={forecast.id} name={forecast.label} dataKey={forecast.id} stroke={colors[index]} dot={false} strokeWidth={2.5} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>}
    <div className="table-wrap"><table className="forecast-table"><thead><tr><th>Berechnungsgrundlage</th><th>Ø pro Tag</th><th>Am Vertragsende</th><th>Rest / Mehrkilometer</th></tr></thead><tbody>{s.forecasts.map((forecast, index) => <tr key={forecast.id}><td><span className="legend-dot" style={{ background: colors[index] }}/><strong>{forecast.label}</strong>{forecast.reason && <small>{forecast.reason}</small>}</td><td data-label="Ø pro Tag">{preciseKm(forecast.dailyKm)} <span>km</span></td><td data-label="Am Vertragsende"><strong>{km(forecast.projectedKm)}</strong> <span>km</span></td><td data-label="Rest / Mehrkilometer" className={forecast.remainingKm !== null && forecast.remainingKm < 0 ? 'text-amber' : 'text-green'}>{forecast.remainingKm === null ? '—' : <><span className="inline-icon">{forecast.remainingKm < 0 ? <ArrowUpRight size={16}/> : <ArrowDownRight size={16}/>}</span>{km(Math.abs(forecast.remainingKm))} km {forecast.remainingKm < 0 ? 'zu viel' : 'übrig'}</>}</td></tr>)}</tbody></table></div><div className="chart-caption"><CircleHelp size={14}/> Lineare Hochrechnung, keine Vorhersage deiner tatsächlichen Fahrten. Unvollständige Zeiträume werden nicht hochgerechnet.</div>
  </section>;
}
function History({ daily, contract }: { daily: DailyDistance[]; contract: DisplayContract }) {
  const [period, setPeriod] = useState('daily');
  const grouped = new Map<string, { label: string; km: number; complete: boolean }>();
  for (const day of daily) {
    const label = period === 'monthly' ? day.date.slice(0, 7) : period === 'yearly' ? `Jahr ${contractYear(day.date, contract.startDate)}` : day.date;
    const previous = grouped.get(label);
    grouped.set(label, { label, km: (previous?.km ?? 0) + day.recordedKm, complete: (previous?.complete ?? true) && day.complete });
  }
  const data = [...grouped.values()].slice(period === 'weekly' ? -7 : period === 'daily' ? -14 : -12);
  return <section className="card history-card"><div className="section-heading"><div><div className="eyebrow">DEIN FAHRVERHALTEN</div><h2>Kilometer im Verlauf</h2></div><select aria-label="Zeitraum der Kilometer-Auswertung" value={period} onChange={event => setPeriod(event.target.value)}><option value="daily">Täglich</option><option value="weekly">7 Tage</option><option value="monthly">Monatlich</option><option value="yearly">Vertragsjahr</option></select></div><div className="history-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)"/><XAxis dataKey="label" tickFormatter={label => String(label).length === 10 ? String(label).slice(8) : String(label)} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} width={35}/><Tooltip formatter={value => `${preciseKm(Number(value))} km erfasst`}/><Bar dataKey="km" name="Erfasste Kilometer" fill="#b6cda4" radius={[4, 4, 0, 0]} maxBarSize={30}/></BarChart></ResponsiveContainer></div><p className="chart-caption">Erfasste Kilometer. {data.some(item => !item.complete) ? 'Enthält unvollständige Zeiträume; fehlende Kilometer sind unbekannt.' : 'Alle angezeigten Tage sind vollständig belegt.'}</p></section>;
}
export function TripTable({ trips, timeZone }: { trips: Trip[]; timeZone: string }) {
  return <section className="card"><div className="section-heading"><h2>Fahrtenbuch</h2><span className="subtle-tag">{trips.length} Fahrten</span></div><div className="trip-cards">{trips.map(trip => <details className="trip-card" key={trip.id}><summary><span>{dateTime(trip.start, timeZone)}<small>{trip.status === 'complete' ? 'Vollständig' : trip.status === 'open' ? 'Unterwegs' : 'Unvollständig'}</small></span><strong>{preciseKm(trip.distanceKm)} km</strong></summary><dl><div><dt>Start</dt><dd>{dateTime(trip.start, timeZone)}</dd></div><div><dt>Ende</dt><dd>{trip.end ? dateTime(trip.end, timeZone) : 'Noch offen'}</dd></div><div><dt>Startstand</dt><dd>{preciseKm(trip.startKm)} km</dd></div><div><dt>Endstand</dt><dd>{preciseKm(trip.endKm)} km</dd></div></dl>{trip.reason && <p>{trip.reason}</p>}</details>)}</div><div className="table-wrap trip-desktop"><table><thead><tr><th>Start</th><th>Ende</th><th>Startstand</th><th>Endstand</th><th>Strecke</th><th>Status</th></tr></thead><tbody>{trips.map(trip => <tr key={trip.id}><td>{dateTime(trip.start, timeZone)}</td><td>{trip.end ? dateTime(trip.end, timeZone) : '—'}</td><td>{preciseKm(trip.startKm)} km</td><td>{preciseKm(trip.endKm)} km</td><td><strong>{preciseKm(trip.distanceKm)} km</strong></td><td><span className={`status-pill ${trip.status === 'complete' ? 'green' : 'amber'}`}>{trip.status === 'complete' ? 'Vollständig' : trip.status === 'open' ? 'Unterwegs' : 'Unvollständig'}</span>{trip.reason && <small>{trip.reason}</small>}</td></tr>)}</tbody></table>{trips.length === 0 && <div className="empty"><Zap size={30}/><p>Noch keine Fahrten erfasst. Nach der Einrichtung funktioniert das automatisch.</p></div>}</div></section>;
}
