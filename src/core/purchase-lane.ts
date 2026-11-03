/**
 * Baraka Market — purchase-receipt lane (pure, localStorage lane).
 * Edit/delete of supplier receipts (BR-…) with exact stock reversal and
 * PMP recompute. All money in float DZD rounded to 2dp — this matches the
 * reception lane (`recordPurchaseReception`), NOT the fiscal centimes core.
 *
 * - delete: every line must be covered by current stock (else refuse —
 *   the goods were already sold, history must not go negative).
 * - edit = reverse old lines + apply new lines (same invoice number kept).
 * - PMP back-out is exact when no other receipt touched the product since;
 *   otherwise it is the best-effort weighted correction (documented, tested).
 *
 * @module core/purchase-lane
 */
import { calculateNewPMP } from '../utils/accounting.js';
import type { PurchaseItem } from '../types/index.js';

export interface LaneProduct {
  id: number;
  stock_qty: number;
  buy_price: number;
}

export interface ReceiptDelta {
  product_id: number;
  quantity: number;
  unit_buy_price_ht: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

function toDelta(it: PurchaseItem): ReceiptDelta {
  return { product_id: it.product_id, quantity: it.quantity, unit_buy_price_ht: it.unit_buy_price_ht };
}

/**
 * Reverse receipt lines from stock. Atomic: validates every line first,
 * then applies. Returns the adjusted list or a refusal reason.
 */
export function reverseReceiptLines<T extends LaneProduct>(
  products: T[],
  items: PurchaseItem[],
): { products: T[]; error: null } | { products: null; error: string } {
  for (const it of items) {
    const p = products.find(x => x.id === it.product_id);
    if (!p) return { products: null, error: `article ${it.product_id} introuvable — suppression impossible` };
    if (r2(p.stock_qty - it.quantity) < 0) {
      return {
        products: null,
        error: `stock insuffisant pour « ${it.name_fr} » (stock ${p.stock_qty}, reçu ${it.quantity}) — vendu depuis, suppression refusée`,
      };
    }
  }
  const deltas = items.map(toDelta);
  return {
    products: products.map(p => {
      const d = deltas.find(x => x.product_id === p.id);
      if (!d) return p;
      const newQty = r2(p.stock_qty - d.quantity);
      // PMP back-out: remove this receipt's contribution from the average.
      // Exact when untouched since; best-effort weighted correction otherwise.
      const newPmp = newQty > 0 ? r2((p.buy_price * p.stock_qty - d.unit_buy_price_ht * d.quantity) / newQty) : d.unit_buy_price_ht;
      return { ...p, stock_qty: newQty, buy_price: newPmp };
    }),
    error: null,
  };
}

/** Apply receipt lines to stock (forward, same math as reception). */
export function applyReceiptLines<T extends LaneProduct>(products: T[], items: PurchaseItem[]): T[] {
  const deltas = items.map(toDelta);
  return products.map(p => {
    const d = deltas.find(x => x.product_id === p.id);
    if (!d) return p;
    return {
      ...p,
      stock_qty: r2(p.stock_qty + d.quantity),
      buy_price: calculateNewPMP(p.stock_qty, p.buy_price, d.quantity, d.unit_buy_price_ht),
    };
  });
}

/**
 * Edit a receipt: reverse old lines, then apply new lines.
 * New lines for products created by the original receipt are the caller's
 * responsibility (same rule as reception: unknown id ⇒ reception creates).
 */
export function editReceiptLines<T extends LaneProduct>(
  products: T[],
  oldItems: PurchaseItem[],
  newItems: PurchaseItem[],
): { products: T[]; error: null } | { products: null; error: string } {
  const rev = reverseReceiptLines(products, oldItems);
  if (rev.products === null) return { products: null, error: rev.error };
  return { products: applyReceiptLines(rev.products, newItems), error: null };
}
