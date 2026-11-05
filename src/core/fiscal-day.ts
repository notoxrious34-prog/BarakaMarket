/**
 * Baraka Market — fiscal day (F2-fix, v1.4.5).
 * The legal day is Africa/Algiers LOCAL time (owner decision 2026-11-04),
 * never UTC: a close at 00:30 local belongs to the new day, not the old one.
 * Algiers observes UTC+1 year-round (no DST since 1981), so the UTC window
 * of a local day is exactly [D-1 23:00Z, D 23:00Z).
 *
 * @module core/fiscal-day
 */

/** IANA zone of the shop. Single constant — one rule, every book. */
export const SHOP_TZ = 'Africa/Algiers';

/** Local calendar day of an instant as YYYY-MM-DD. */
export function fiscalDayISO(d: Date = new Date(), tz: string = SHOP_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string): string => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** UTC instant bounds [start, end) covering one local day (ISO strings). */
export function fiscalDayBoundsUTC(day: string, plusOne = '+01:00'): { start: string; end: string } {
  const start = new Date(`${day}T00:00:00${plusOne}`).toISOString();
  const endMs = Date.parse(`${day}T00:00:00${plusOne}`) + 86_400_000;
  return { start, end: new Date(endMs).toISOString() };
}
