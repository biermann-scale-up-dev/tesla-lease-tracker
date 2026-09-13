import { Temporal } from '@js-temporal/polyfill';
import type { Store } from './store.js';
import { emptyTeslaStatus } from './store.js';
import { ingestRecord } from './telemetry.js';

export const demoVin = '5YJ3E1EA7KF000000';
export function seedDemo(store: Store, at: string): void {
  if (store.contract() || store.teslaStatus().vehicle) throw new Error('Demo requires an empty database; use a separate DATABASE_PATH.');
  const today = Temporal.Instant.from(at).toZonedDateTimeISO('Europe/Berlin').toPlainDate();
  const contractStart = today.subtract({ days: 270 });
  store.setSetting('demo', true);
  store.setSetting('contract', { startDate: contractStart.toString(), endDate: contractStart.add({ months: 36 }).toString(), handoverKm: 120, totalKm: 60_000, timeZone: 'Europe/Berlin' });
  store.setSetting('tesla', { ...emptyTeslaStatus(), connected: false, vehicle: { vin: demoVin, name: 'Model 3 · Demo', model: '3' }, firmware: '2026.26.6', telemetryVersion: '1.3.0', keyPaired: false, configured: false, synced: false });
  let odometer = 7_620;
  const emit = (timestamp: string, gear: 'P' | 'D' | 'R') => {
    const raw = JSON.stringify({ vin: demoVin, createdAt: timestamp, data: [{ key: 'Gear', value: { shiftStateValue: `ShiftState${gear}` } }, { key: 'Odometer', value: { doubleValue: odometer / 1.609344 } }] });
    ingestRecord(store, { topic: 'tesla_V', raw, headers: { vin: demoVin }, receivedAt: at });
  };
  emit(today.subtract({ days: 111 }).toZonedDateTime('Europe/Berlin').toInstant().toString(), 'P');
  for (let daysAgo = 110; daysAgo >= 1; daysAgo--) {
    const date = today.subtract({ days: daysAgo });
    if (date.dayOfWeek === 7) continue;
    for (const hour of [8, 17]) {
      emit(date.toZonedDateTime({ timeZone: 'Europe/Berlin', plainTime: `${hour.toString().padStart(2, '0')}:00` }).toInstant().toString(), 'D');
      odometer += (daysAgo <= 7 ? 45 : daysAgo <= 30 ? 31 : 19) + daysAgo % 7;
      emit(date.toZonedDateTime({ timeZone: 'Europe/Berlin', plainTime: `${hour.toString().padStart(2, '0')}:42` }).toInstant().toString(), 'P');
    }
  }
  emit(today.toZonedDateTime('Europe/Berlin').toInstant().toString(), 'P');
}
