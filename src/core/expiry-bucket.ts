/**
 * C4 (PLAN-v1.2.0): in-screen expiry alerts — pure bucketing.
 * expired (past date) · soon (≤15d, same window as the POS card badge) ·
 * later/none. Alert only, never a sale block (no fiscal behavior change).
 */
export type ExpiryBucket = 'expired' | 'soon' | 'later' | 'none';

const DAY_MS = 24 * 3600 * 1000;

export function expiryBucket(
  hasExpiry: boolean,
  expiryDate: string | undefined,
  todayMs: number = Date.now(),
): ExpiryBucket {
  if (!hasExpiry || !expiryDate) return 'none';
  // Calendar-day diff on date parts (tz-proof: date-only stamps are UTC
  // midnight, local midnights shift by the zone offset).
  const m = expiryDate.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'none';
  const t = new Date(todayMs);
  const dayIndex = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d) / DAY_MS;
  const diff = dayIndex(+m[1], +m[2], +m[3]) - dayIndex(t.getFullYear(), t.getMonth() + 1, t.getDate());
  if (diff < 0) return 'expired';
  if (diff <= 15) return 'soon';
  return 'later';
}
