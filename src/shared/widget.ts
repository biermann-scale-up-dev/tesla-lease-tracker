import type { Contract, ForecastBasis, Summary, WidgetSummary } from './types.js';

export function widgetSummary(summary: Summary | null, contract: Contract | null, basis: ForecastBasis, demo: boolean, at: string): WidgetSummary {
  return {
    version: 1, asOf: summary?.asOf ?? at, odometerAt: summary?.odometerAt ?? null,
    timeZone: contract?.timeZone ?? 'Europe/Berlin', demo,
    remainingKm: summary?.remainingKm ?? null, usedKm: summary?.usedKm ?? null,
    allowedKm: summary?.allowedKm ?? null, deviationKm: summary?.deviationKm ?? null,
    ended: summary?.ended ?? false, forecasts: summary?.forecasts ?? [],
    forecast: summary?.forecasts.find(item => item.id === basis) ?? null,
    lastTrip: summary?.trips.find(trip => trip.end !== null) ?? null,
    quality: { gaps: summary?.gaps.length ?? 0, unassignedKm: summary?.unassignedKm ?? 0,
      incompleteTrips: summary?.trips.filter(trip => trip.status !== 'complete').length ?? 0,
      trackingSince: summary?.trackingSince ?? null },
  };
}
