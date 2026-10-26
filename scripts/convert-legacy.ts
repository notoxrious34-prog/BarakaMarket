/**
 * Shared legacy (float DZD) -> deterministic (centimes/milli) converters.
 * Used by seed-db and migrate-localstorage. All money leaves here as integers.
 */
import { dzdToCentimes } from '../src/core/money.js';
import type { Client, Product, Supplier, TVARate } from '../src/types/index.js';
import type { ProductRow, Unit } from '../src/db/sqlite.js';

export function qtyToMilli(qty: number): number {
  if (!Number.isFinite(qty) || qty < 0) throw new Error(`[convert] invalid qty: ${qty}`);
  return Math.round(qty * 1000);
}

function assertTva(tva: number): asserts tva is TVARate {
  if (tva !== 0 && tva !== 9 && tva !== 19) throw new Error(`[convert] bad TVA: ${tva}`);
}

export function productToRow(p: Product): ProductRow {
  assertTva(p.tva_rate);
  return {
    id: p.id,
    barcode: p.barcode,
    name_fr: p.name_fr,
    name_ar: p.name_ar,
    category_id: p.category_id,
    buy_price_ct: dzdToCentimes(p.buy_price),
    sell_price_ct: dzdToCentimes(p.sell_price),
    tva_rate: p.tva_rate,
    stock_milli: qtyToMilli(p.stock_qty),
    min_stock_milli: qtyToMilli(p.min_stock_alert),
    unit: p.unit as Unit,
    is_scale: p.is_scale_product ? 1 : 0,
    scale_item_code: p.scale_item_code ?? null,
    has_expiry: p.has_expiry_date ? 1 : 0,
    expiry_date: p.expiry_date ?? null,
  };
}

export interface ClientRow {
  id: number; name: string; phone: string; address: string;
  nif: string | null; nis: string | null; rc: string | null; ai: string | null;
  credit_balance_ct: number; max_credit_limit_ct: number; notes: string | null;
}

export function clientToRow(c: Client): ClientRow {
  return {
    id: c.id, name: c.name, phone: c.phone, address: c.address,
    nif: c.nif ?? null, nis: c.nis ?? null, rc: c.rc ?? null, ai: c.ai ?? null,
    credit_balance_ct: dzdToCentimes(c.credit_balance),
    max_credit_limit_ct: dzdToCentimes(c.max_credit_limit),
    notes: c.notes ?? null,
  };
}

export interface SupplierRow {
  id: number; name: string; contact_person: string; phone: string; address: string;
  nif: string | null; nis: string | null; rc: string | null; ai: string | null;
  balance_due_ct: number; payment_terms: string | null; category: string;
}

export function supplierToRow(s: Supplier): SupplierRow {
  return {
    id: s.id, name: s.name, contact_person: s.contact_person, phone: s.phone,
    address: s.address, nif: s.nif ?? null, nis: s.nis ?? null, rc: s.rc ?? null,
    ai: s.ai ?? null, balance_due_ct: dzdToCentimes(s.balance_due),
    payment_terms: s.payment_terms ?? null, category: s.category,
  };
}
