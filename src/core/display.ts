/**
 * Baraka Market — Display bindings over the deterministic centimes engine.
 * Drop-in replacement for the deprecated `utils/fiscal` float formatting.
 * Every formatter rounds through INTEGER centimes first — no float drift.
 *
 * @module core/display
 */
import { CENTIMES_PER_DZD, assertIntegerCentimes, dzdToCentimes, formatDZDFromCentimes } from './money.js';

/**
 * Format a DZD float (React state / legacy call sites) as Algerian Dinars.
 * Rounds half-up through integer centimes, then groups thousands.
 * e.g. formatDZD(1794) -> "1 794.00 DZD"
 */
export function formatDZD(amount: number, showDecimals = true): string {
  if (typeof amount !== 'number' || isNaN(amount)) return '0.00 DZD';
  return formatDZDFromCentimes(dzdToCentimes(amount), showDecimals);
}

/**
 * Format an integer-centimes value directly (preferred for fiscal surfaces).
 * e.g. formatDZDFromCt(179400) -> "1 794.00 DZD"
 */
export function formatDZDFromCt(ct: number, showDecimals = true): string {
  assertIntegerCentimes(ct, 'ct');
  return formatDZDFromCentimes(ct, showDecimals);
}

/** Display-only DZD → centimes conversion (rounds half-up). */
export function toCentimes(dzd: number): number {
  return dzdToCentimes(dzd);
}

/** Display-only centimes → DZD conversion. NEVER compute on the result. */
export function toDzd(ct: number): number {
  assertIntegerCentimes(ct, 'ct');
  return ct / CENTIMES_PER_DZD;
}

/**
 * OWNER-2026-11-12 (Caisse): weighable quantities DISPLAY in grams.
 * Display-only — storage/fiscal stay kg + integer milli-units.
 * e.g. formatGrams(1.45) -> "1450 g" (latin g, LTR-safe).
 */
export function formatGrams(kg: number): string {
  if (typeof kg !== 'number' || isNaN(kg)) return '0 g';
  return `${Math.round(kg * 1000)} g`;
}
