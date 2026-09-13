import type { ServiceStatus } from '../shared/types.js';

export async function receiverStatus(url: string): Promise<ServiceStatus['receiver']> {
  if (!url) return 'unchecked';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'error' });
    return response.ok && (await response.text()).trim() === 'ok' ? 'connected' : 'error';
  } catch {
    // A failed liveness probe is a reported outage, never evidence of vehicle sleep.
    return 'error';
  }
}
