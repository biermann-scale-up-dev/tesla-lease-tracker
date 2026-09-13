import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructTrips, summarize } from '../src/shared/analytics.js';
import { addDays, contractYear, daysBetween, localDate } from '../src/shared/dates.js';
import type { Contract } from '../src/shared/types.js';
import { contractSchema, preferencesSchema } from '../src/shared/types.js';
import { createStore, insert, vin } from './fixtures.js';

const contract: Contract = { startDate: '2026-01-01', endDate: '2027-01-01', handoverKm: 1000, totalKm: 12_000, timeZone: 'Europe/Berlin' };

test('real SQLite ingestion: parking splits trips; D/R changes do not; duplicates and late events reconstruct identically', () => {
  const { store, cleanup } = createStore();
  try {
    insert(store, '2026-03-01T07:00:00Z', 'P', 1000);
    insert(store, '2026-03-01T08:00:00Z', 'D', 1000);
    insert(store, '2026-03-01T08:30:00Z', 'P', 1020);
    insert(store, '2026-03-01T08:20:00Z', 'R', 1019);
    insert(store, '2026-03-01T08:20:30Z', 'N', 1019);
    insert(store, '2026-03-01T08:21:00Z', 'D', 1019);
    assert.equal(insert(store, '2026-03-01T08:30:00Z', 'P', 1020), 'duplicate');
    insert(store, '2026-03-01T08:31:00Z', 'R', 1020);
    insert(store, '2026-03-01T09:00:00Z', 'P', 1030);
    const { trips, gaps } = reconstructTrips(store.samples(vin));
    assert.equal(trips.length, 2);
    assert.ok(Math.abs(trips[0]!.distanceKm! - 20) < 0.00001);
    assert.ok(Math.abs(trips[1]!.distanceKm! - 10) < 0.00001);
    assert.deepEqual(gaps, []);
  } finally { cleanup(); }
});
test('missing start/end, falling odometer, and unassigned mileage stay visible', () => {
  const { store, cleanup } = createStore();
  try {
    insert(store, '2026-03-01T07:00:00Z', 'D', 1000);
    insert(store, '2026-03-01T08:00:00Z', 'P', 1020);
    insert(store, '2026-03-01T09:00:00Z', 'D', 1050);
    insert(store, '2026-03-01T10:00:00Z', 'P', null);
    insert(store, '2026-03-01T11:00:00Z', 'P', 900);
    const result = summarize(contract, { windows: [7, 30, 90] }, store.samples(vin), '2026-03-02T12:00:00Z');
    assert.equal(result.trips.filter(trip => trip.status === 'incomplete').length, 2);
    assert.ok(Math.abs(result.unassignedKm - 50) < 0.00001);
    assert.equal(result.odometerKm, 1050);
    assert.equal(result.odometerAt, '2026-03-01T09:00:00.000Z');
    assert.ok(result.gaps.some(gap => gap.reason.includes('rückläufig')));
    assert.ok(result.forecasts.slice(0, 3).every(forecast => forecast.projectedKm === null));
  } finally { cleanup(); }
});
test('mid-contract start uses handover baseline, contract dates clamp before/after end', () => {
  const { store, cleanup } = createStore();
  try {
    insert(store, '2026-07-01T00:00:00Z', 'P', 7000);
    const result = summarize(contract, { windows: [7, 30, 90] }, store.samples(vin), '2026-07-01T12:00:00Z');
    assert.equal(result.usedKm, 6000);
    assert.equal(result.remainingKm, 6000);
    assert.ok(result.forecasts.at(-1)!.projectedKm! > 12_000);
    assert.equal(result.forecasts[0]!.projectedKm, null);
    const ended = summarize(contract, { windows: [7, 30, 90] }, store.samples(vin), '2027-02-01T12:00:00Z');
    assert.equal(ended.remainingDays, 0); assert.equal(ended.ended, true); assert.equal(ended.dailyBudgetKm, null);
    assert.ok(ended.forecasts.every(forecast => forecast.projectedKm === null));
    const future = summarize(contract, { windows: [7, 30, 90] }, [], '2025-12-15T12:00:00Z');
    assert.equal(future.elapsedDays, 0); assert.equal(future.allowedKm, 0);
  } finally { cleanup(); }
});
test('seven proved calendar days include parked days; current day and insufficient windows are excluded', () => {
  const { store, cleanup } = createStore();
  try {
    insert(store, '2026-03-01T23:00:00Z', 'P', 1000);
    insert(store, '2026-03-04T09:00:00Z', 'D', 1000);
    insert(store, '2026-03-04T10:00:00Z', 'P', 1070);
    insert(store, '2026-03-08T23:00:00Z', 'P', 1070);
    const result = summarize(contract, { windows: [7, 30, 90] }, store.samples(vin), '2026-03-09T12:00:00Z');
    assert.equal(result.forecasts[0]!.observedDays, 7);
    assert.equal(result.forecasts[0]!.dailyKm, 10);
    assert.equal(result.forecasts[1]!.projectedKm, null);
    assert.equal(result.daily.filter(day => day.distanceKm === 0).length, 6);
    assert.ok(result.daily.every(day => day.date < '2026-03-09'));
  } finally { cleanup(); }
});
test('a missing trip suppresses affected window; a later parked checkpoint never hides distance', () => {
  const { store, cleanup } = createStore();
  try {
    insert(store, '2026-03-01T23:00:00Z', 'P', 1000);
    insert(store, '2026-03-08T23:00:00Z', 'P', 1070);
    const result = summarize(contract, { windows: [7, 30, 90] }, store.samples(vin), '2026-03-09T12:00:00Z');
    assert.equal(result.forecasts[0]!.projectedKm, null);
    assert.ok(Math.abs(result.unassignedKm - 70) < 0.00001);
  } finally { cleanup(); }
});
test('open trip remains open; midnight mileage belongs to arrival day', () => {
  const { store, cleanup } = createStore();
  try {
    insert(store, '2026-03-01T00:00:00Z', 'P', 1000);
    insert(store, '2026-03-02T22:45:00Z', 'D', 1000);
    assert.equal(reconstructTrips(store.samples(vin)).trips[0]!.status, 'open');
    insert(store, '2026-03-02T23:15:00Z', 'P', 1020);
    insert(store, '2026-03-03T23:01:00Z', 'P', 1020);
    const result = summarize(contract, { windows: [1, 2, 3] }, store.samples(vin), '2026-03-04T12:00:00Z');
    assert.ok(Math.abs(result.daily.find(day => day.date === '2026-03-03')!.recordedKm - 20) < 0.00001);
    assert.equal(result.daily.find(day => day.date === '2026-03-02')!.recordedKm, 0);
  } finally { cleanup(); }
});
test('calendar math handles DST, leap days, anniversaries, and invalid settings', () => {
  assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(localDate('2026-03-29T22:30:00Z', 'Europe/Berlin'), '2026-03-30');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(contractYear('2026-05-01', '2025-05-01'), 2);
  assert.equal(contractYear('2026-04-30', '2025-05-01'), 1);
  assert.equal(contractSchema.safeParse({ ...contract, endDate: contract.startDate }).success, false);
  assert.equal(contractSchema.safeParse({ ...contract, startDate: '2026-02-30' }).success, false);
  assert.equal(preferencesSchema.safeParse({ windows: [0, 30, 90] }).success, false);
});

test('a missing parked odometer leaves the entire recovery interval incomplete', () => {
  const { store, cleanup } = createStore();
  try {
    insert(store, '2026-03-01T00:00:00Z', 'P', 1000);
    insert(store, '2026-03-02T00:00:00Z', 'P', null);
    insert(store, '2026-03-05T00:00:00Z', 'P', 1100);
    const result = summarize(contract, { windows: [1, 2, 3] }, store.samples(vin), '2026-03-05T12:00:00Z');
    assert.ok(result.forecasts.slice(0, 3).every(forecast => forecast.projectedKm === null));
    assert.ok(Math.abs(result.unassignedKm - 100) < 0.00001);
  } finally { cleanup(); }
});

test('all comparison windows use their own daily average and overrun remains negative', () => {
  const { store, cleanup } = createStore();
  try {
    insert(store, '2026-03-01T23:00:00Z', 'P', 1000);
    let km = 1000;
    for (const [day, distance] of [[2, 10], [3, 20], [4, 30]]) {
      insert(store, `2026-03-0${day}T08:00:00Z`, 'D', km);
      km += distance!;
      insert(store, `2026-03-0${day}T09:00:00Z`, 'P', km);
    }
    insert(store, '2026-03-04T23:00:00Z', 'P', km);
    const result = summarize({ ...contract, totalKm: 50 }, { windows: [1, 2, 3] }, store.samples(vin), '2026-03-05T12:00:00Z');
    assert.deepEqual(result.forecasts.slice(0, 3).map(forecast => Math.round(forecast.dailyKm!)), [30, 25, 20]);
    assert.ok(Math.abs(result.remainingKm! + 10) < 0.00001);
    for (const forecast of result.forecasts) assert.equal(forecast.projectedKm, result.usedKm! + forecast.dailyKm! * result.remainingDays);
  } finally { cleanup(); }
});
