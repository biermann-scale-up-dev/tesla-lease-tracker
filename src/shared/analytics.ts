import type { Contract, DailyDistance, Forecast, Gap, Preferences, Sample, Summary, Trip } from './types.js';
import { addDays, daysBetween, localDate, startOfDay } from './dates.js';

const distanceTolerance = 0.001;
const millis = (at: string): number => Date.parse(at);
function markIncomplete(trip: Trip, reason: string): Trip { return { ...trip, reason, status: 'incomplete' }; }

export function reconstructTrips(input: readonly Sample[]): { trips: Trip[]; gaps: Gap[]; samples: Sample[] } {
  const samples = [...input].sort((a, b) => millis(a.at) - millis(b.at) || a.id.localeCompare(b.id));
  const trips: Trip[] = [];
  const gaps: Gap[] = [];
  const normalized: Sample[] = [];
  let uncertaintyStart: string | null = null;
  let previous: Sample | null = null;
  let lastOdometer: number | null = null;
  let active: Trip | null = null;
  for (const sample of samples) {
    const decreasing: boolean = sample.odometerKm !== null && lastOdometer !== null && sample.odometerKm + distanceTolerance < lastOdometer;
    const reading: number | null = decreasing ? null : sample.odometerKm;
    if (decreasing || reading === null || sample.gear === null) {
      uncertaintyStart ??= previous?.at ?? sample.at;
      const reason = decreasing ? 'Kilometerstand ist rückläufig.' : 'Gang oder Kilometerstand fehlt.';
      gaps.push({ start: previous?.at ?? sample.at, end: sample.at, reason, unassignedKm: 0 });
      if (active) active = markIncomplete(active, reason);
    } else if (uncertaintyStart !== null) {
      gaps.push({ start: uncertaintyStart, end: sample.at, reason: 'Zeitraum zwischen ungültigem und nächstem gültigen Messpunkt.', unassignedKm: 0 });
      uncertaintyStart = null;
    }
    if (previous?.gear === 'P' && previous.odometerKm !== null && reading !== null && reading > previous.odometerKm + distanceTolerance) {
      gaps.push({ start: previous.at, end: sample.at, reason: 'Kilometer ohne erfasste Fahrt.', unassignedKm: reading - previous.odometerKm });
    }
    if (sample.gear !== null && sample.gear !== 'P' && active === null) {
      const hasStart = previous?.gear === 'P' && reading !== null;
      active = { id: sample.id, start: sample.at, end: null, startKm: reading, endKm: null, distanceKm: null, status: hasStart ? 'open' : 'incomplete', reason: hasStart ? null : 'Fahrtbeginn nicht vollständig erfasst.' };
    } else if (sample.gear === 'P' && active !== null) {
      const distance = active.startKm !== null && reading !== null ? reading - active.startKm : null;
      const complete = active.reason === null && distance !== null && distance >= 0;
      const trip: Trip = { ...active, end: sample.at, endKm: reading, distanceKm: complete ? distance : null, status: complete ? 'complete' : 'incomplete', reason: complete ? null : active.reason ?? 'Kilometerstand am Fahrtende fehlt.' };
      trips.push(trip);
      if (!complete) gaps.push({ start: active.start, end: sample.at, reason: trip.reason ?? 'Unvollständige Fahrt.', unassignedKm: distance !== null && distance > 0 ? distance : 0 });
      active = null;
    }
    if (reading !== null) lastOdometer = reading;
    previous = { ...sample, odometerKm: reading };
    normalized.push(previous);
  }
  if (active) {
    trips.push(active);
    if (active.reason) gaps.push({ start: active.start, end: samples.at(-1)!.at, reason: active.reason, unassignedKm: 0 });
  }
  return { samples: normalized, trips, gaps };
}

function dailyDistances(samples: readonly Sample[], trips: readonly Trip[], gaps: readonly Gap[], contract: Contract, today: string): DailyDistance[] {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) return [];
  const captureDate = localDate(first.at, contract.timeZone);
  const start = captureDate > contract.startDate ? captureDate : contract.startDate;
  const end = today < contract.endDate ? today : contract.endDate;
  const output: DailyDistance[] = [];
  for (let date = start; date < end; date = addDays(date, 1)) {
    const dayStart = millis(startOfDay(date, contract.timeZone));
    const dayEnd = millis(startOfDay(addDays(date, 1), contract.timeZone));
    const ending = trips.filter(trip => trip.end !== null && localDate(trip.end, contract.timeZone) === date);
    const overlaps = gaps.some(gap => millis(gap.start) < dayEnd && millis(gap.end) >= dayStart);
    const open = trips.some(trip => trip.end === null && millis(trip.start) < dayEnd);
    // A subsequent checkpoint is required to prove that a silent day was actually parked.
    const complete = millis(first.at) <= dayStart && millis(last.at) >= dayEnd && !overlaps && !open && ending.every(trip => trip.status === 'complete');
    const recordedKm = ending.reduce((sum, trip) => sum + (trip.distanceKm ?? 0), 0);
    output.push({ date, distanceKm: complete ? recordedKm : null, recordedKm, trips: ending.length, complete });
  }
  return output;
}

export function summarize(contract: Contract, preferences: Preferences, input: readonly Sample[], at: string): Summary {
  const today = localDate(at, contract.timeZone);
  const { trips, gaps, samples } = reconstructTrips(input.filter(sample => millis(sample.at) <= millis(at)));
  const valid = samples.filter(sample => sample.odometerKm !== null);
  const last = valid.at(-1);
  const highestKm = valid.reduce((high, sample) => Math.max(high, sample.odometerKm ?? 0), 0);
  const validLatest = last?.odometerKm !== undefined && last.odometerKm !== null && last.odometerKm >= highestKm && last.odometerKm >= contract.handoverKm;
  const odometerKm = validLatest ? last.odometerKm : null;
  // The end date is the exclusive boundary, matching the start of the return day.
  const totalDays = daysBetween(contract.startDate, contract.endDate);
  const elapsedDays = Math.max(0, Math.min(totalDays, daysBetween(contract.startDate, today)));
  const remainingDays = totalDays - elapsedDays;
  const ended = today >= contract.endDate;
  const usedKm = odometerKm === null ? null : odometerKm - contract.handoverKm;
  const allowedKm = contract.totalKm * elapsedDays / totalDays;
  const remainingKm = usedKm === null ? null : contract.totalKm - usedKm;
  const daily = dailyDistances(samples, trips, gaps, contract, today);
  const forecasts: Forecast[] = preferences.windows.map((days, index) => {
    const start = addDays(today, -days);
    const window = daily.filter(day => day.date >= start && day.date < today);
    const observedDays = window.filter(day => day.complete).length;
    const ready = observedDays === days && usedKm !== null && today >= contract.startDate && !ended;
    const dailyKm = ready ? window.reduce((sum, day) => sum + (day.distanceKm ?? 0), 0) / days : null;
    const projectedKm = dailyKm === null || usedKm === null ? null : usedKm + dailyKm * remainingDays;
    return { id: `window-${index}`, label: `${days} Tage`, days, observedDays, dailyKm, projectedKm, remainingKm: projectedKm === null ? null : contract.totalKm - projectedKm, reason: ready ? null : ended ? 'Vertrag beendet' : usedKm === null ? 'Gültiger Kilometerstand fehlt' : `${observedDays} von ${days} Tagen vollständig erfasst` };
  });
  const contractDaily = usedKm !== null && elapsedDays > 0 && !ended ? usedKm / elapsedDays : null;
  const contractProjected = contractDaily === null || usedKm === null ? null : usedKm + contractDaily * remainingDays;
  const knownTravel = Math.max(0, highestKm - (valid[0]?.odometerKm ?? highestKm));
  const assignedTravel = trips.reduce((sum, trip) => sum + (trip.distanceKm ?? (trip.status === 'open' && trip.startKm !== null ? Math.max(0, highestKm - trip.startKm) : 0)), 0);
  forecasts.push({ id: 'contract', label: 'Seit Vertragsbeginn', days: null, observedDays: elapsedDays, dailyKm: contractDaily, projectedKm: contractProjected, remainingKm: contractProjected === null ? null : contract.totalKm - contractProjected, reason: contractProjected === null ? ended ? 'Vertrag beendet' : 'Noch keine belastbare Vertragsgrundlage' : null });
  return { asOf: at, trackingSince: samples[0]?.at ?? null, odometerAt: last?.at ?? null, odometerKm, usedKm, allowedKm, remainingKm, deviationKm: usedKm === null ? null : usedKm - allowedKm, dailyBudgetKm: remainingKm === null || remainingDays === 0 ? null : remainingKm / remainingDays, remainingDays, elapsedDays, totalDays, unassignedKm: Math.max(0, knownTravel - assignedTravel), ended, trips: [...trips].reverse(), gaps, daily, forecasts };
}
