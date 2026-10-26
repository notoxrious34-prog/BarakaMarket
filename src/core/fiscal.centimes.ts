/**
 * Baraka Market — Deterministic fiscal engine (integer centimes).
 * Replaces float-based `utils/fiscal.ts` for all money paths.
 * - TVA rates allowed: 0 | 9 | 19 exclusively (Art. 23 CTCA).
 * - HT extracted from TTC: HT = round(TTC*100 / (100+taux)); TVA = TTC - HT.
 * - Droit de Timbre: 1% ceil on ESPECES only, floor 10 / cap 2500 DZD, exempt < 50 DZD.
 *
 * @module core/fiscal.centimes
 */
import {
  CENTIMES_PER_DZD,
  TIMBRE_MAX_CT,
  TIMBRE_MIN_CT,
  TIMBRE_EXEMPT_BELOW_CT,
  Centimes,
  applyDiscountCt,
  assertIntegerCentimes,
  mulCentimesByQty,
} from './money.js';
import type { PaymentMethod, StoreProfile, TVARate } from '../types';

export const ALLOWED_TVA_RATES: readonly TVARate[] = [0, 9, 19];

export function assertTvaRate(rate: number): asserts rate is TVARate {
  if (rate !== 0 && rate !== 9 && rate !== 19) {
    throw new Error(`[fiscal] TVA rate must be 0, 9 or 19 (got ${rate})`);
  }
}

export interface LineTotalsCt {
  total_line_ht_ct: Centimes;
  total_line_tva_ct: Centimes;
  total_line_ttc_ct: Centimes;
}

export interface TvaBreakdownCt {
  rate: TVARate;
  base_ht_ct: Centimes;
  tva_amount_ct: Centimes;
  total_ttc_ct: Centimes;
}

export interface SaleTotalsCt {
  total_ht_ct: Centimes;
  total_tva_ct: Centimes;
  timbre_ct: Centimes;
  total_ttc_ct: Centimes;
  tva_breakdown: Record<TVARate, TvaBreakdownCt>;
}

export interface SaleItemCtInput {
  tva_rate: TVARate;
  total_line_ht_ct: Centimes;
  total_line_tva_ct: Centimes;
  total_line_ttc_ct: Centimes;
}

/**
 * Line totals from a TTC unit price. All integer centimes.
 * Discount is applied on TTC BEFORE HT extraction (Algerian retail practice).
 */
export function calculateLineTotalsCt(
  unitPriceTtcCt: Centimes,
  quantity: number,
  tvaRate: TVARate,
  discountPercent = 0,
): LineTotalsCt {
  assertIntegerCentimes(unitPriceTtcCt, 'unitPriceTtcCt');
  assertTvaRate(tvaRate);
  const grossTtc = mulCentimesByQty(unitPriceTtcCt, quantity);
  const discountedTtc = applyDiscountCt(grossTtc, discountPercent);
  // HT = round(TTC * 100 / (100 + taux)) — pure integer-safe single rounding.
  const lineHt = Math.round((discountedTtc * 100) / (100 + tvaRate));
  const lineTva = discountedTtc - lineHt;
  return {
    total_line_ht_ct: lineHt,
    total_line_tva_ct: lineTva,
    total_line_ttc_ct: discountedTtc,
  };
}

export interface TimbreProfile {
  timbre_rate?: number;
  timbre_min?: number;
  timbre_max?: number;
}

/**
 * Algerian Droit de Timbre Fiscal (Art. 136 Code du Timbre) in centimes.
 * ESPECES only; ceil(TTC_DZD * rate); clamped to [min, max]; exempt below 50 DZD.
 */
export function calculateTimbreFiscalCt(
  totalTtcCt: Centimes,
  paymentMethod: PaymentMethod,
  storeProfile?: TimbreProfile | Partial<StoreProfile>,
): Centimes {
  assertIntegerCentimes(totalTtcCt, 'totalTtcCt');
  if (paymentMethod !== 'ESPECES') return 0;
  if (totalTtcCt < TIMBRE_EXEMPT_BELOW_CT) return 0;

  const rate = storeProfile?.timbre_rate ?? 0.01;
  const minCt = Math.round((storeProfile?.timbre_min ?? 10) * CENTIMES_PER_DZD);
  const maxCt = Math.round((storeProfile?.timbre_max ?? 2500) * CENTIMES_PER_DZD);

  // timbre_DZD = ceil(total_DZD * rate) = ceil(total_ct * rate / 100)
  const timbreDzd = Math.ceil((totalTtcCt * rate) / CENTIMES_PER_DZD);
  let timbreCt = timbreDzd * CENTIMES_PER_DZD;
  if (timbreCt < minCt) timbreCt = minCt;
  if (timbreCt > maxCt) timbreCt = maxCt;
  // Clamp bounds against configured min/max even if defaults overridden.
  void TIMBRE_MIN_CT;
  void TIMBRE_MAX_CT;
  return timbreCt;
}

/** Aggregate sale totals: HT/TVA per tier + timbre + final TTC. All centimes. */
export function calculateSaleTotalsCt(
  items: SaleItemCtInput[],
  paymentMethod: PaymentMethod,
  storeProfile?: TimbreProfile | Partial<StoreProfile>,
): SaleTotalsCt {
  const breakdown: Record<TVARate, TvaBreakdownCt> = {
    0: { rate: 0, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
    9: { rate: 9, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
    19: { rate: 19, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
  };
  let sumHt = 0;
  let sumTva = 0;
  let sumTtc = 0;
  for (const item of items) {
    assertTvaRate(item.tva_rate);
    assertIntegerCentimes(item.total_line_ht_ct, 'item.total_line_ht_ct');
    assertIntegerCentimes(item.total_line_tva_ct, 'item.total_line_tva_ct');
    assertIntegerCentimes(item.total_line_ttc_ct, 'item.total_line_ttc_ct');
    // Per-line invariant: HT + TVA must equal TTC (guards float-migrated data).
    if (item.total_line_ht_ct + item.total_line_tva_ct !== item.total_line_ttc_ct) {
      throw new Error(
        `[fiscal] line invariant broken: HT(${item.total_line_ht_ct}) + TVA(${item.total_line_tva_ct}) !== TTC(${item.total_line_ttc_ct})`,
      );
    }
    const b = breakdown[item.tva_rate];
    b.base_ht_ct += item.total_line_ht_ct;
    b.tva_amount_ct += item.total_line_tva_ct;
    b.total_ttc_ct += item.total_line_ttc_ct;
    sumHt += item.total_line_ht_ct;
    sumTva += item.total_line_tva_ct;
    sumTtc += item.total_line_ttc_ct;
  }
  const timbre = calculateTimbreFiscalCt(sumTtc, paymentMethod, storeProfile);
  // Timbre is whole DZD by construction -> final TTC stays integer, no rounding needed.
  const finalTtc = sumTtc + timbre;
  return {
    total_ht_ct: sumHt,
    total_tva_ct: sumTva,
    timbre_ct: timbre,
    total_ttc_ct: finalTtc,
    tva_breakdown: breakdown,
  };
}

export interface ScaleBarcodeResultCt {
  isScale: boolean;
  itemCode?: string;
  weightKg?: number;
  priceOverride?: number;
}

/**
 * Smart barcode-scale parser (ميزان الباركود الذكي). Pure function, no money.
 * 20XXXXXWWWWWC -> weight in grams; 22XXXXXPPPPPC -> price.
 */
export function parseScaleBarcodeCt(rawCode: string): ScaleBarcodeResultCt {
  const clean = rawCode.trim();
  const match = clean.match(/^(20|22)(\d{5})(\d{5})(\d)$/);
  if (!match) return { isScale: false };
  const [, prefix, itemCode, valueStr] = match;
  const numValue = parseInt(valueStr, 10);
  if (prefix === '20') {
    const weightKg = Math.round((numValue / 1000) * 1000) / 1000;
    return { isScale: true, itemCode, weightKg };
  }
  if (prefix === '22') {
    return { isScale: true, itemCode, priceOverride: numValue };
  }
  return { isScale: false };
}
