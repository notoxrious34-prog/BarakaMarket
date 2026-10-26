/**
 * Browser-facing bridge: identical signatures to legacy `utils/fiscal`
 * (float DZD in/out for React state), but every computation runs through
 * the integer-centimes engine. Drop-in replacement for AppContext call sites.
 *
 * @module core/cart-bridge
 */
import { centimesToDzd, dzdToCentimes } from './money.js';
import {
  calculateLineTotalsCt,
  calculateSaleTotalsCt,
  type SaleTotalsCt,
} from './fiscal.centimes.js';
import type { PaymentMethod, SaleItem, StoreProfile, TVABreakdown, TVARate } from '../types/index.js';

export function calculateLineTotals(
  unitPriceTTC: number,
  quantity: number,
  tvaRate: TVARate,
  discountPercent = 0,
): { total_line_ht: number; total_line_tva: number; total_line_ttc: number } {
  const ct = calculateLineTotalsCt(dzdToCentimes(unitPriceTTC), quantity, tvaRate, discountPercent);
  return {
    total_line_ht: centimesToDzd(ct.total_line_ht_ct),
    total_line_tva: centimesToDzd(ct.total_line_tva_ct),
    total_line_ttc: centimesToDzd(ct.total_line_ttc_ct),
  };
}

export function calculateSaleTotals(
  items: SaleItem[],
  paymentMethod: PaymentMethod,
  storeProfile?: Partial<StoreProfile>,
): {
  total_ht: number;
  total_tva: number;
  timbre_fiscal: number;
  total_ttc: number;
  tva_breakdown: Record<TVARate, TVABreakdown>;
} {
  // Recompute lines from (unit price, qty) — never trust stored floats.
  const ctItems = items.map((it) => {
    const l = calculateLineTotalsCt(
      dzdToCentimes(it.unit_price_ttc), it.quantity, it.tva_rate, it.discount_percent,
    );
    return { tva_rate: it.tva_rate, ...l };
  });
  const t: SaleTotalsCt = calculateSaleTotalsCt(ctItems, paymentMethod, storeProfile);
  const conv = (ct: number) => ct / 100;
  const breakdown = {
    0: { rate: 0 as TVARate, base_ht: conv(t.tva_breakdown[0].base_ht_ct), tva_amount: conv(t.tva_breakdown[0].tva_amount_ct), total_ttc: conv(t.tva_breakdown[0].total_ttc_ct) },
    9: { rate: 9 as TVARate, base_ht: conv(t.tva_breakdown[9].base_ht_ct), tva_amount: conv(t.tva_breakdown[9].tva_amount_ct), total_ttc: conv(t.tva_breakdown[9].total_ttc_ct) },
    19: { rate: 19 as TVARate, base_ht: conv(t.tva_breakdown[19].base_ht_ct), tva_amount: conv(t.tva_breakdown[19].tva_amount_ct), total_ttc: conv(t.tva_breakdown[19].total_ttc_ct) },
  };
  return {
    total_ht: conv(t.total_ht_ct),
    total_tva: conv(t.total_tva_ct),
    timbre_fiscal: conv(t.timbre_ct),
    total_ttc: conv(t.total_ttc_ct),
    tva_breakdown: breakdown,
  };
}
