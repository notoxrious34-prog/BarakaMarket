/**
 * Baraka Market — Product authority bridge (T4c, ADR-027).
 * One-way catalog mirror: UI (localStorage) -> native SQLite, so the Rust
 * sale lane decrements MATCHED rows. The UI keeps reading its own store;
 * this module only ensures the fiscal stock mirror exists in the exe lane.
 * Outside Tauri every function is a deliberate no-op (null / 0 synced).
 *
 * @module core/product-authority
 */
import type { Product } from '../types/index.js';
import { isTauriRuntime } from './fiscal-authority.js';

export interface NativeProductPayload {
  id: number; barcode: string; name_fr: string; name_ar: string;
  category_id: string; buy_price_ct: number; sell_price_ct: number;
  tva_rate: number; stock_milli: number; min_stock_milli: number;
  unit: string; is_scale: number; scale_item_code: string;
  has_expiry: number; expiry_date: string;
}

/** Pure mapping UI Product -> native row (centimes/milli, rounded). */
export function toNativeProduct(p: Product): NativeProductPayload {
  return {
    id: p.id,
    barcode: p.barcode,
    name_fr: p.name_fr,
    name_ar: p.name_ar ?? '',
    category_id: p.category_id ?? '',
    buy_price_ct: Math.round((p.buy_price ?? 0) * 100),
    sell_price_ct: Math.round((p.sell_price ?? 0) * 100),
    tva_rate: p.tva_rate,
    stock_milli: Math.round((p.stock_qty ?? 0) * 1000),
    min_stock_milli: Math.round((p.min_stock_alert ?? 0) * 1000),
    unit: p.unit,
    is_scale: p.is_scale_product ? 1 : 0,
    scale_item_code: p.scale_item_code ?? '',
    has_expiry: p.has_expiry_date ? 1 : 0,
    expiry_date: p.expiry_date ?? '',
  };
}

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    return ((await mod.invoke(command, args)) as T) ?? null;
  } catch {
    return null;
  }
}

/**
 * Push the whole UI catalog into the native mirror (once per session —
 * the caller guards with a ref). Returns the synced count; 0 outside Tauri
 * or when the shell refuses (sale lane then NULLs unknown FKs, as before).
 */
export async function syncCatalogToNative(products: Product[]): Promise<{ synced: number }> {
  if (!isTauriRuntime() || products.length === 0) return { synced: 0 };
  let synced = 0;
  for (const p of products) {
    if (!Number.isInteger(p.id) || p.id <= 0) continue;
    const r = await invokeNative<{ id?: number }>('product_upsert', { product: toNativeProduct(p) });
    if (r && r.id === p.id) synced += 1;
    else break; // shell refused mid-sync: stop, retry next session
  }
  return { synced };
}

/** Read the native stock mirror (null outside Tauri / on refusal). */
export async function listNativeProducts(): Promise<NativeProductPayload[] | null> {
  const r = await invokeNative<NativeProductPayload[]>('product_list');
  return Array.isArray(r) ? r : null;
}

/** Native POS lookup by barcode/name fragment (null outside Tauri). */
export async function searchNativeProducts(query: string): Promise<NativeProductPayload[] | null> {
  if (!query) return [];
  const r = await invokeNative<NativeProductPayload[]>('product_search', { query });
  return Array.isArray(r) ? r : null;
}
