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
 * Shop fiscal regime (owner toggles, Card 3 «Régime fiscal»).
 * - tva_enabled=false: every sale line is computed as TVA 0 (TTC becomes HT,
 *   Algerian forfait/IFU practice) — the Z chain stays coherent (sums are sums).
 * - timbre_enabled=false: no Droit de Timbre is added, even on ESPECES.
 * Both travel with every commit (header.fiscal_regime) and are stored per sale
 * so an auditor can replay WHY a 5000 DZD cash sale carries timbre 0.
 * Defaults (absent flags) = enabled: existing rows behave exactly as before.
 */
export interface FiscalRegime {
  tva_enabled?: boolean;
  timbre_enabled?: boolean;
}

export type FiscalProfile = TimbreProfile & FiscalRegime;

/** Fresh-line rate under the active regime: disabled TVA forces 0 at the source. */
export function effectiveTvaRate(rate: TVARate, regime?: FiscalRegime): TVARate {
  assertTvaRate(rate);
  return regime?.tva_enabled === false ? 0 : rate;
}

/** Ticket/quittance regime footnote (null = standard taxed ticket, nothing to say). */
export function regimeNoteFor(regime: FiscalRegime | undefined, isAr: boolean): string | null {
  if (!regime) return null;
  const parts: string[] = [];
  if (regime.tva_enabled === false) {
    parts.push(isAr ? 'نظام جزافي — TVA غير مطبقة' : 'Régime forfaitaire — TVA non applicable');
  }
  if (regime.timbre_enabled === false) {
    parts.push(isAr ? 'الطابع غير مطبق' : 'Timbre non appliqué');
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Algerian Droit de Timbre Fiscal (Art. 136 Code du Timbre) in centimes.
 * ESPECES only; ceil(TTC_DZD * rate); clamped to [min, max]; exempt below 50 DZD.
 */
export function calculateTimbreFiscalCt(
  totalTtcCt: Centimes,
  paymentMethod: PaymentMethod,
  storeProfile?: TimbreProfile | FiscalProfile | Partial<StoreProfile>,
): Centimes {
  assertIntegerCentimes(totalTtcCt, 'totalTtcCt');
  if ((storeProfile as FiscalProfile | undefined)?.timbre_enabled === false) return 0;
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
  storeProfile?: TimbreProfile | FiscalProfile | Partial<StoreProfile>,
): SaleTotalsCt {
  const breakdown: Record<TVARate, TvaBreakdownCt> = {
    0: { rate: 0, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
    9: { rate: 9, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
    19: { rate: 19, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
  };
  let sumHt = 0;
  let sumTva = 0;
  let sumTtc = 0;
  const tvaOff = (storeProfile as FiscalProfile | undefined)?.tva_enabled === false;
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
    // Regime TVA off: the TTC line total is ground truth; the whole line
    // collapses into tier 0 (HT=TTC, TVA=0) — HT+TVA=TTC preserved by construction.
    const effRate: TVARate = tvaOff ? 0 : item.tva_rate;
    const lh = tvaOff ? item.total_line_ttc_ct : item.total_line_ht_ct;
    const la = tvaOff ? 0 : item.total_line_tva_ct;
    const b = breakdown[effRate];
    b.base_ht_ct += lh;
    b.tva_amount_ct += la;
    b.total_ttc_ct += item.total_line_ttc_ct;
    sumHt += lh;
    sumTva += la;
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

export type ScalePrefix = '20' | '21' | '22' | '28' | '29';
export type ScaleMode = 'WEIGHT' | 'PRICE';

export interface ScaleBarcodeResultCt {
  isScale: boolean;
  prefix?: ScalePrefix;
  /** 5-digit zero-padded scale item code, e.g. '00142'. */
  itemCode?: string;
  rawNumericCode?: number;
  mode?: ScaleMode;
  /** Integer grams — equals qty_milli (schema: 1.45 kg -> 1450). */
  weightGrams?: number;
  /** Integer centimes (price labels store whole DINARS: priceCt = VVVVV * 100). */
  priceCt?: number;
}

/**
 * EAN-13 modulo-10 check digit (GS1). Exactly 13 numeric digits; weights 1/3
 * alternating from the left; valid only when the 13th digit matches.
 */
export function isValidEan13(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(barcode[i], 10) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === parseInt(barcode[12], 10);
}

const SCALE_PREFIXES: readonly string[] = ['20', '21', '22', '28', '29'];

function matchScaleLayout(clean: string): { prefix: ScalePrefix; itemCode: string; valueStr: string } | null {
  if (clean.length !== 13 || /^[0-9]+$/.test(clean) === false) return null;
  const prefix = clean.slice(0, 2);
  if (SCALE_PREFIXES.indexOf(prefix) === -1) return null;
  return { prefix: prefix as ScalePrefix, itemCode: clean.slice(2, 7), valueStr: clean.slice(7, 12) };
}

/**
 * Universal variable-weight parser (ADR-003-MKT). Pure, no money math.
 * Layout PP IIIII VVVVV C — checksum-gated: corrupted reads return
 * isScale:false so the caller falls through to the standard lookup.
 * - WEIGHT (20, 21, 28 default): VVVVV = grams -> weightGrams (= qty_milli).
 * - PRICE (22, 29, 28 with prefix28AsPrice): VVVVV = whole DZD -> priceCt = V*100.
 */
export function parseScaleBarcodeCt(
  rawCode: string,
  opts?: { prefix28AsPrice?: boolean },
): ScaleBarcodeResultCt {
  const clean = rawCode.trim();
  const parts = matchScaleLayout(clean);
  if (!parts || !isValidEan13(clean)) return { isScale: false };
  const numValue = parseInt(parts.valueStr, 10);
  const rawNumericCode = parseInt(parts.itemCode, 10);
  const isPrice =
    parts.prefix === '22' || parts.prefix === '29' || (parts.prefix === '28' && opts?.prefix28AsPrice === true);
  if (isPrice) {
    return {
      isScale: true, prefix: parts.prefix, itemCode: parts.itemCode,
      rawNumericCode, mode: 'PRICE', priceCt: numValue * 100,
    };
  }
  return {
    isScale: true, prefix: parts.prefix, itemCode: parts.itemCode,
    rawNumericCode, mode: 'WEIGHT', weightGrams: numValue,
  };
}

export interface CashChangeCt {
  changeCt: Centimes;
  isValid: boolean;
  deficitCt: Centimes;
}

/**
 * Cash tender settlement in strict integer centimes (ADR-005-MKT).
 * Tendered comes from the DZD input via dzdToCentimes; no floats below.
 */
export function calculateCashChange(totalTtcCt: Centimes, tenderedCt: Centimes): CashChangeCt {
  assertIntegerCentimes(totalTtcCt, 'totalTtcCt');
  assertIntegerCentimes(tenderedCt, 'tenderedCt');
  return {
    changeCt: Math.max(0, tenderedCt - totalTtcCt) as Centimes,
    isValid: tenderedCt >= totalTtcCt,
    deficitCt: Math.max(0, totalTtcCt - tenderedCt) as Centimes,
  };
}

/**
 * Algerian smart note presets (centimes, deduped ascending, all >= total):
 * exact, 500/1000/2000 thresholds, next x1000 multiple, next x2000
 * multiple, 5000. E.g. 1430 DZD -> [143000, 200000, 500000].
 */
export function smartCashPresetsCt(totalTtcCt: Centimes): Centimes[] {
  assertIntegerCentimes(totalTtcCt, 'totalTtcCt');
  const DZD = 100;
  const out = new Set<Centimes>([totalTtcCt]);
  for (const note of [500, 1000, 2000]) {
    if (totalTtcCt <= note * DZD) out.add((note * DZD) as Centimes);
  }
  out.add((Math.ceil(totalTtcCt / (1000 * DZD)) * 1000 * DZD) as Centimes);
  out.add((Math.ceil(totalTtcCt / (2000 * DZD)) * 2000 * DZD) as Centimes);
  out.add((5000 * DZD) as Centimes);
  return [...out].filter(v => v >= totalTtcCt).sort((a, b) => a - b);
}
