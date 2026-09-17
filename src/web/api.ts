export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function getJSON<T>(path: string): Promise<T> { return readResponse<T>(await fetch(path, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })); }
export async function sendJSON<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown): Promise<T> {
  return readResponse<T>(await fetch(path, { method, credentials: 'same-origin', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}
async function readResponse<T>(response: Response): Promise<T> {
  const value: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !response.url.endsWith('/api/login') && !response.url.includes('/api/widget-summary')) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string' ? value.error : `Anfrage fehlgeschlagen (${response.status}).`, response.status);
  }
  return value as T;
}
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Unbekannter Fehler.';
export const km = (value: number | null): string => value === null ? '—' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
export const preciseKm = (value: number | null): string => value === null ? '—' : new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
export function dateTime(at: string | null, timeZone: string): string {
  return at ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(at)) : 'Noch keine Daten';
}

export function forecastRemaining(value: number | null): string { return value === null ? 'Noch keine belastbare Prognose' : `${km(Math.abs(value))} km ${value < 0 ? 'zu viel' : 'übrig'}`; }
