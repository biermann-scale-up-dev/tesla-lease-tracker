import { Temporal } from '@js-temporal/polyfill';

export function localDate(instant: string, timeZone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}
export function addDays(date: string, days: number): string { return Temporal.PlainDate.from(date).add({ days }).toString(); }
export function daysBetween(start: string, end: string): number { return Temporal.PlainDate.from(start).until(Temporal.PlainDate.from(end), { largestUnit: 'days' }).days; }
export function startOfDay(date: string, timeZone: string): string { return Temporal.PlainDate.from(date).toZonedDateTime(timeZone).toInstant().toString(); }
export function contractYear(date: string, startDate: string): number {
  return Temporal.PlainDate.from(startDate).until(Temporal.PlainDate.from(date), { largestUnit: 'years' }).years + 1;
}
export function addMonths(date: string, months: number): string { return Temporal.PlainDate.from(date).add({ months }).toString(); }
