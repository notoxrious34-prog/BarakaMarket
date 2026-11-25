/**
 * ADR-051 P0 — Produit Rapide: pure builder + validation (no I/O).
 * The rapide line rides the EXISTING lanes as product_id 0 (always absent
 * from `products`): both lanes NULL the FK, skip the stock decrement and
 * flag was_negative=1 (sqlite.ts:2252, fiscal.rs:919 — read-verified).
 * Merge-safety (R1): packName carries the label so distinct labels never
 * merge while identical label+price still merge.
 */
import type { Product } from '../types';
import type { AddToCartPack } from './cart-state';

/** Synthetic id — never a real product row (ids start at 1). */
export const RAPIDE_PID = 0;
export const RAPIDE_BARCODE = '*PRIX-LIBRE*';
export const RAPIDE_NAME_FR = '⚡ Produit Rapide';
export const RAPIDE_NAME_AR = '⚡ منتج سريع';

export type RapideTva = 0 | 9 | 19;
export type RapideUnit = 'PIECE' | 'KG';

export interface RapideInput {
  label: string;
  /** TTC unit price in centimes (integer). */
  priceTtcCt: number;
  quantity: number;
  tva: RapideTva;
  unit: RapideUnit;
}

export const RAPIDE_MAX_PRICE_CT = 999999999;
export const RAPIDE_MAX_QTY = 9999;

/** Machine-readable validation codes — the UI maps them to AR/FR. */
export type RapideError = 'LABEL' | 'PRICE' | 'QTY' | 'TVA';

export function validateRapideInput(i: RapideInput): RapideError[] {
  const errs: RapideError[] = [];
  if (!i.label || i.label.trim().length < 2) errs.push('LABEL');
  if (!Number.isInteger(i.priceTtcCt) || i.priceTtcCt <= 0 || i.priceTtcCt > RAPIDE_MAX_PRICE_CT) errs.push('PRICE');
  if (!Number.isFinite(i.quantity) || i.quantity <= 0 || i.quantity > RAPIDE_MAX_QTY) errs.push('QTY');
  if (i.tva !== 0 && i.tva !== 9 && i.tva !== 19) errs.push('TVA');
  return errs;
}

export interface RapideAdd {
  product: Product;
  pack: AddToCartPack;
  quantity: number;
}

/** Synthesize the catalog-shaped product + pack the cart lane expects. */
export function buildRapideAdd(i: RapideInput): RapideAdd {
  const label = i.label.trim();
  const unit: 'PIECE' | 'KG' | 'LITRE' = i.unit === 'KG' ? 'KG' : 'PIECE';
  const product: Product = {
    id: RAPIDE_PID,
    barcode: RAPIDE_BARCODE,
    name_fr: RAPIDE_NAME_FR,
    name_ar: RAPIDE_NAME_AR,
    category_id: 'rapide',
    buy_price: 0,
    sell_price: i.priceTtcCt / 100,
    tva_rate: i.tva,
    stock_qty: 0,
    min_stock_alert: 0,
    unit,
    has_expiry_date: false,
  };
  return { product, pack: { packName: label, barcode: RAPIDE_BARCODE }, quantity: i.quantity };
}
