import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, SunMoon } from 'lucide-react';
import { errorMessage } from './api.js';

type Theme = 'system' | 'light' | 'dark';
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
const InstallContext = createContext<{ prompt: InstallEvent | null; clear: () => void }>({ prompt: null, clear: () => {} });
const DirtyContext = createContext({ dirty: false, mark: (id: string, dirty: boolean) => { void id; void dirty; } });
export function useDirty(id: string, dirty: boolean): void {
  const { mark } = useContext(DirtyContext);
  useEffect(() => { mark(id, dirty); return () => mark(id, false); }, [mark, id, dirty]);
}
export function Experience({ children }: { children: ReactNode }) {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const ready = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener('beforeinstallprompt', ready); return () => window.removeEventListener('beforeinstallprompt', ready);
  }, []);
  const [forms, setForms] = useState<string[]>([]);
  const mark = useCallback((id: string, dirty: boolean) => setForms(previous => dirty ? previous.includes(id) ? previous : [...previous, id] : previous.includes(id) ? previous.filter(item => item !== id) : previous), []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (forms.length) event.preventDefault(); };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [forms]);
  return <DirtyContext.Provider value={{ dirty: forms.length > 0, mark }}><InstallContext.Provider value={{ prompt: install, clear: () => setInstall(null) }}><ThemeSync/><PwaUpdate/>{children}</InstallContext.Provider></DirtyContext.Provider>;
}
function readTheme(): Theme { const theme = localStorage.getItem('lease-theme'); return theme === 'light' || theme === 'dark' ? theme : 'system'; }
function ThemeSync() {
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = readTheme(); const dark = theme === 'dark' || (theme === 'system' && query.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111e19' : '#f5f6f1');
    };
    apply(); query.addEventListener('change', apply); window.addEventListener('theme-change', apply); window.addEventListener('storage', apply);
    return () => { query.removeEventListener('change', apply); window.removeEventListener('theme-change', apply); window.removeEventListener('storage', apply); };
  }, []);
  return null;
}
export function Appearance() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  return <section className="card"><div className="section-heading"><h2>Darstellung</h2><SunMoon size={22}/></div><label className="setting-control">Farbschema<select value={theme} onChange={event => { const value = event.target.value as Theme; localStorage.setItem('lease-theme', value); setTheme(value); window.dispatchEvent(new Event('theme-change')); }}><option value="system">System</option><option value="light">Hell</option><option value="dark">Dunkel</option></select></label></section>;
}
export function Installation() {
  const { prompt, clear } = useContext(InstallContext);
  const [error, setError] = useState<string | null>(null);
  return <section className="card"><div className="section-heading"><h2>Auf deinem Homescreen</h2><Download size={22}/></div><p className="setting-control">Auf dem iPhone in Safari: Teilen → Zum Home-Bildschirm. Danach öffnet sich Lease Tracker wie eine App.</p><p>Der letzte erfolgreiche Datenstand bleibt bis zum Ablauf deiner Sitzung offline lesbar. Beim Abmelden wird er gelöscht.</p>{prompt && <button className="button primary" onClick={() => void prompt.prompt().then(() => prompt.userChoice).then(clear).catch(cause => setError(errorMessage(cause)))}>App installieren</button>}{error && <p role="alert">{error}</p>}</section>;
}
function PwaUpdate() {
  const { dirty } = useContext(DirtyContext);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let alive = true;
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => {
      const check = () => { if (alive && registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting); };
      check();
      registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', check));
      void registration.update().catch(cause => { if (alive && navigator.onLine) setError(errorMessage(cause)); });
    }).catch(cause => { if (alive) setError(errorMessage(cause)); });
    return () => { alive = false; };
  }, []);
  if (error) return <div className="update-banner" role="alert">Offline-Installation nicht verfügbar: {error}</div>;
  if (!waiting) return null;
  return <div className="update-banner" role="status"><span>Neue App-Version verfügbar.{dirty ? ' Bitte zuerst Änderungen speichern.' : ''}</span><button className="button primary" disabled={dirty} onClick={() => {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  }}>Jetzt aktualisieren</button></div>;
}
