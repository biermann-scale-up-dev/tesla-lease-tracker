import { z } from 'zod';
import type { Gear, Sample } from '../shared/types.js';
import { digest } from './security.js';
import type { Store } from './store.js';

const timestamp = z.string().datetime({ offset: true });
const recordSchema = z.object({ vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/), createdAt: timestamp, data: z.array(z.object({ key: z.enum(['Gear', 'Odometer']), value: z.record(z.string(), z.unknown()) })).max(2), isResend: z.boolean().optional() });
const connectivitySchema = z.object({ vin: z.string(), createdAt: timestamp, status: z.string(), connectionId: z.string().optional() });
export interface IncomingRecord { topic: string; raw: string; headers: Record<string, string>; receivedAt: string }

function gearValue(value: Record<string, unknown>): Gear | null {
  if (value.invalid === true) return null;
  const gear = value.shiftStateValue;
  if (gear === 'ShiftStateP') return 'P';
  if (gear === 'ShiftStateD') return 'D';
  if (gear === 'ShiftStateR') return 'R';
  if (gear === 'ShiftStateN') return 'N';
  return null;
}
function odometerValue(value: Record<string, unknown>): number | null {
  if (value.invalid === true) return null;
  const source = value.doubleValue ?? value.floatValue ?? value.stringValue;
  if (typeof source !== 'number' && typeof source !== 'string') return null;
  if (typeof source === 'string' && !/^\d+(\.\d+)?$/.test(source)) return null;
  const miles = Number(source);
  return Number.isFinite(miles) && miles >= 0 ? miles * 1.609344 : null;
}
export function decodeSample(raw: string, receivedAt: string): { sample: Sample; fields: number } {
  const record = recordSchema.parse(JSON.parse(raw) as unknown);
  if (Date.parse(record.createdAt) > Date.parse(receivedAt) + 300_000) throw new Error('Fahrzeugzeit liegt mehr als fünf Minuten in der Zukunft.');
  if (new Set(record.data.map(datum => datum.key)).size !== record.data.length) throw new Error('Telemetrie enthält doppelte Felder.');
  const gear = record.data.find(datum => datum.key === 'Gear');
  const odo = record.data.find(datum => datum.key === 'Odometer');
  const canonical = { vin: record.vin, at: new Date(record.createdAt).toISOString(), data: [...record.data].sort((a, b) => a.key.localeCompare(b.key)) };
  return { sample: { id: digest(JSON.stringify(canonical)), vin: record.vin, at: canonical.at, gear: gear ? gearValue(gear.value) : null, odometerKm: odo ? odometerValue(odo.value) : null }, fields: record.data.length };
}

export function ingestRecord(store: Store, incoming: IncomingRecord): 'inserted' | 'duplicate' | 'rejected' {
  const vehicle = store.teslaStatus().vehicle;
  if (!vehicle) throw new Error('Vor dem Telemetrie-Empfang muss ein Fahrzeug ausgewählt sein.');
  let decoded: { id: string; vin: string; at: string; kind: string; sample: Sample | null; status: string | null; fields: number };
  try {
    if (incoming.topic.endsWith('_V')) {
      const { sample, fields } = decodeSample(incoming.raw, incoming.receivedAt);
      decoded = { id: sample.id, vin: sample.vin, at: sample.at, kind: 'V', sample, status: null, fields };
    } else if (incoming.topic.endsWith('_connectivity')) {
      const record = connectivitySchema.parse(JSON.parse(incoming.raw) as unknown);
      decoded = { id: digest(JSON.stringify(record)), vin: record.vin, at: record.createdAt, kind: 'connectivity', sample: null, status: record.status, fields: 0 };
    } else { throw new Error('Unbekanntes Telemetrie-Topic.'); }
    if (decoded.vin !== vehicle.vin || (incoming.headers.vin !== undefined && incoming.headers.vin !== vehicle.vin)) throw new Error('VIN stimmt nicht mit dem ausgewählten Fahrzeug überein.');
  } catch (error) {
    // Do not retain unexpected payloads: they may contain unrequested location data.
    const reason = error instanceof Error ? error.message : 'Ungültiger Telemetrie-Datensatz';
    store.db.prepare('INSERT OR IGNORE INTO rejected_records VALUES (?,?,?)').run(digest(incoming.raw), incoming.receivedAt, reason.slice(0, 1000));
    return 'rejected';
  }
  return store.transaction(() => {
    const result = store.db.prepare('INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?,?)').run(decoded.id, decoded.vin, decoded.at, decoded.kind, incoming.raw, JSON.stringify(incoming.headers), incoming.receivedAt);
    if (Number(result.changes) === 0) return 'duplicate';
    if (decoded.sample) {
      const sample = decoded.sample;
      store.db.prepare('INSERT INTO samples VALUES (?,?,?,?,?)').run(sample.id, sample.vin, sample.at, sample.gear, sample.odometerKm);
    }
    if (decoded.status) {
      const prior = store.setting('connectivity');
      const checkpoint = prior === null ? null : z.object({ at: timestamp }).parse(prior);
      if (checkpoint === null || Date.parse(decoded.at) >= Date.parse(checkpoint.at)) store.setSetting('connectivity', { at: decoded.at, status: decoded.status });
    }
    store.setSetting('lastMessageAt', incoming.receivedAt);
    return 'inserted';
  });
}
