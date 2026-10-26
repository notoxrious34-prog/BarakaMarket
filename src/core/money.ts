/**
 * Baraka Market — Money primitives (integer centimes).
 * DOSTOUR: every amount in the engine is an integer number of centimes (DZD*100).
 * `float / double` is FORBIDDEN for money. Display layer divides by 100 only.
 *
 * @module core/money
 */

/** Integer centimes. Always an integer (e.g. 180 DZD === 18000). */
export type Centimes = number;

export const CENTIMES_PER_DZD = 100;

/** Fiscal timbre bounds in centimes (10 DZD .. 2500 DZD). */
export const TIMBRE_MIN_CT: Centimes = 1000;
export const TIMBRE_MAX_CT: Centimes = 250000;
/** Timbre exemption threshold: sales below 50 DZD pay no stamp duty. */
export const TIMBRE_EXEMPT_BELOW_CT: Centimes = 5000;

export function assertIntegerCentimes(value: number, label = 'centimes'): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`[money] ${label} must be an integer number of centimes, got: ${value}`);
  }
}

/** Convert a DZD float (legacy/UI input) to integer centimes. Rounds half-up. */
export function dzdToCentimes(dzd: number): Centimes {
  if (!Number.isFinite(dzd)) {
    throw new Error(`[money] cannot convert non-finite DZD value: ${dzd}`);
  }
  return Math.round(dzd * CENTIMES_PER_DZD);
}

/** Convert integer centimes back to DZD float for DISPLAY ONLY. Never compute on the result. */
export function centimesToDzd(ct: Centimes): number {
  assertIntegerCentimes(ct);
  return ct / CENTIMES_PER_DZD;
}

/** Multiply a unit price (ct) by a quantity (supports KG decimals). Result stays integer. */
export function mulCentimesByQty(unitPriceCt: Centimes, quantity: number): Centimes {
  assertIntegerCentimes(unitPriceCt, 'unitPriceCt');
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`[money] invalid quantity: ${quantity}`);
  }
  return Math.round(unitPriceCt * quantity);
}

/** Apply a discount percent (0-100) on a gross TTC amount in centimes. */
export function applyDiscountCt(grossTtcCt: Centimes, discountPercent = 0): Centimes {
  assertIntegerCentimes(grossTtcCt, 'grossTtcCt');
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new Error(`[money] invalid discountPercent: ${discountPercent}`);
  }
  if (discountPercent === 0) return grossTtcCt;
  return Math.round(grossTtcCt * (1 - discountPercent / 100));
}

/**
 * Format centimes as Algerian Dinars with space-grouped thousands.
 * e.g. 179400 -> "1 794.00 DZD"
 */
export function formatDZDFromCentimes(ct: Centimes, showDecimals = true): string {
  assertIntegerCentimes(ct);
  const negative = ct < 0;
  const abs = Math.abs(ct);
  const integerPart = Math.floor(abs / 100);
  const decimals = abs % 100;
  const grouped = integerPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = negative ? '-' : '';
  if (!showDecimals) return `${sign}${grouped} DZD`;
  return `${sign}${grouped}.${decimals.toString().padStart(2, '0')} DZD`;
}
