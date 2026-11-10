/**
 * Baraka Market — pure cart line operations (TASK-MKT-001).
 * Extracted from AppContext so the high-frequency cart state can live in a
 * dedicated memoized CartContext. 100% pure: (prev, args) -> next, no I/O.
 * Money stays in DZD units here (display domain); the fiscal lane converts
 * to centimes at commit time via calculateSaleTotalsCt.
 */
import type { Product, SaleItem } from '../types';
import { calculateLineTotals } from './cart-bridge';

export interface AddToCartPack {
  unitPriceTtc?: number;
  packMultiplier?: number;
  packName?: string;
  barcode?: string;
}

/** Append or merge a line. Same product + same unit price + same pack merges. */
export function addCartLine(
  prev: SaleItem[],
  product: Product,
  quantity = 1,
  discountPercent = 0,
  pack?: AddToCartPack,
): SaleItem[] {
  const unitPrice = pack?.unitPriceTtc ?? product.sell_price;
  const existingIndex = prev.findIndex(
    item => item.product_id === product.id
      && item.unit_price_ttc === unitPrice
      && (item.packName ?? '') === (pack?.packName ?? ''),
  );
  if (existingIndex >= 0) {
    const existing = prev[existingIndex];
    const newQty = existing.quantity + quantity;
    const lineTotals = calculateLineTotals(
      unitPrice, newQty, product.tva_rate, discountPercent || existing.discount_percent,
    );
    const updated = [...prev];
    updated[existingIndex] = {
      ...existing,
      quantity: newQty,
      discount_percent: discountPercent || existing.discount_percent,
      ...lineTotals,
    };
    return updated;
  }
  const lineTotals = calculateLineTotals(unitPrice, quantity, product.tva_rate, discountPercent);
  const rowBarcode = pack?.barcode ?? product.barcode;
  const rowNameFr = pack?.packName ? `${product.name_fr} [${pack.packName}]` : product.name_fr;
  const newItem: SaleItem = {
    product_id: product.id,
    barcode: rowBarcode,
    name_fr: rowNameFr,
    name_ar: product.name_ar,
    unit_price_ttc: unitPrice,
    quantity,
    unit: product.unit,
    tva_rate: product.tva_rate,
    discount_percent: discountPercent,
    packMultiplier: pack?.packMultiplier,
    packName: pack?.packName,
    ...lineTotals,
  };
  return [...prev, newItem];
}

/** Set a line quantity (<=0 removes the line, mirroring the old behaviour). */
export function updateCartLineQty(prev: SaleItem[], index: number, quantity: number): SaleItem[] {
  if (quantity <= 0) return removeCartLine(prev, index);
  const item = prev[index];
  if (!item) return prev;
  const lineTotals = calculateLineTotals(
    item.unit_price_ttc, quantity, item.tva_rate, item.discount_percent,
  );
  const updated = [...prev];
  updated[index] = { ...item, quantity, ...lineTotals };
  return updated;
}

/** Set a line discount percent. */
export function updateCartLineDiscount(prev: SaleItem[], index: number, discountPercent: number): SaleItem[] {
  const item = prev[index];
  if (!item) return prev;
  const lineTotals = calculateLineTotals(
    item.unit_price_ttc, item.quantity, item.tva_rate, discountPercent,
  );
  const updated = [...prev];
  updated[index] = { ...item, discount_percent: discountPercent, ...lineTotals };
  return updated;
}

/** Remove a line by index. */
export function removeCartLine(prev: SaleItem[], index: number): SaleItem[] {
  return prev.filter((_, i) => i !== index);
}
