import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';

const date = z.string().refine(value => { try { return Temporal.PlainDate.from(value).toString() === value; } catch { return false; } }, 'Datum muss YYYY-MM-DD entsprechen.');
export const contractSchema = z.object({
  startDate: date,
  endDate: date,
  handoverKm: z.number().finite().nonnegative(),
  totalKm: z.number().finite().positive().max(2_000_000),
  timeZone: z.string().refine(value => { try { new Intl.DateTimeFormat('de', { timeZone: value }); return true; } catch { return false; } }, 'Ungültige Zeitzone.'),
}).strict().refine(value => value.endDate > value.startDate, 'Vertragsende muss nach Vertragsbeginn liegen.');
export type Contract = z.infer<typeof contractSchema>;
export const preferencesSchema = z.object({ windows: z.tuple([z.number().int().min(1).max(365), z.number().int().min(1).max(365), z.number().int().min(1).max(365)]) }).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export type Gear = 'P' | 'D' | 'R' | 'N';
export interface Sample { id: string; vin: string; at: string; gear: Gear | null; odometerKm: number | null }
export interface Gap { start: string; end: string; reason: string; unassignedKm: number }
export interface Trip { id: string; start: string; end: string | null; startKm: number | null; endKm: number | null; distanceKm: number | null; status: 'complete' | 'incomplete' | 'open'; reason: string | null }
export interface DailyDistance { date: string; distanceKm: number | null; recordedKm: number; trips: number; complete: boolean }
export interface Forecast { id: string; label: string; days: number | null; observedDays: number; dailyKm: number | null; projectedKm: number | null; remainingKm: number | null; reason: string | null }
export interface Summary {
  asOf: string; trackingSince: string | null; odometerAt: string | null; odometerKm: number | null;
  usedKm: number | null; allowedKm: number; remainingKm: number | null; deviationKm: number | null;
  dailyBudgetKm: number | null; remainingDays: number; elapsedDays: number; totalDays: number;
  totals: { todayRecordedKm: number; todayTrips: number; completeTrips: number; incompleteTrips: number };
  unassignedKm: number; ended: boolean; trips: Trip[]; gaps: Gap[]; daily: DailyDistance[]; forecasts: Forecast[];
}
export interface Vehicle { vin: string; name: string; model: '3' | 'Y' }
export interface TeslaStatus { connected: boolean; vehicle: Vehicle | null; firmware: string | null; telemetryVersion: string | null; keyPaired: boolean; configured: boolean; synced: boolean; checkedAt: string | null; problem: string | null }
export interface ServiceStatus { broker: 'disabled' | 'connecting' | 'connected' | 'error'; receiver: 'unchecked' | 'connected' | 'error'; lastMessageAt: string | null; vehicleConnectivity: string | null; rejectedRecords: number; problem: string | null }
export interface Dashboard { contract: Contract | null; preferences: Preferences; summary: Summary | null; tesla: TeslaStatus; service: ServiceStatus; demo: boolean }

export const forecastBasisSchema = z.enum(['window-0', 'window-1', 'window-2', 'contract']);
export type ForecastBasis = z.infer<typeof forecastBasisSchema>;
export const deviceKindSchema = z.enum(['scriptable', 'tesla']);
export const deviceSettingsSchema = z.object({ name: z.string().trim().min(1).max(60), forecastBasis: forecastBasisSchema }).strict();
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;
export interface PairedDevice extends DeviceSettings { id: string; kind: z.infer<typeof deviceKindSchema>; createdAt: string; lastUsedAt: string | null }
export interface Session { authenticated: boolean; expiresAt: number | null }
export interface WidgetSummary {
  version: 1; asOf: string; odometerAt: string | null; timeZone: string; demo: boolean;
  remainingKm: number | null; usedKm: number | null; allowedKm: number | null; deviationKm: number | null;
  ended: boolean; forecast: Forecast | null; forecasts: Forecast[]; lastTrip: Trip | null;
  quality: { gaps: number; unassignedKm: number; incompleteTrips: number; trackingSince: string | null };
}
// Only display metadata, never the contract editor's handover reading or vehicle credentials.
export type DisplayContract = Pick<Contract, 'startDate' | 'endDate' | 'totalKm' | 'timeZone'>;
export interface OfflineSnapshot {
  version: 1; savedAt: string; expiresAt: number; contract: DisplayContract | null;
  preferences: Preferences; summary: Summary | null; demo: boolean;
}
