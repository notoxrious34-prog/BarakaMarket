/**
 * ADR-053 P3 — pinned-tiles lane authority (dual-lane parity).
 *
 * Read path:  native `product_pinned(today)` → loopback `GET /api/products/pinned`
 *              → null when both lanes are down (tiles stay on the UI cache).
 * Write path: native `product_set_pin` → loopback `POST /api/products/pin`.
 *              Both lanes enforce the same rules (1..12, evict, POIDS-Q4);
 *              the owner gate + audit live with the caller.
 * Mirror:     `mergePinsInto(products, pins)` overlays DB pin fields onto the
 *              UI catalog (UI cache stays master — same doctrine as syncCatalogToNative).
 */
import { isTauriRuntime, LOOPBACK_BASE, getLoopbackToken } from './fiscal-authority.js';
import type { Product } from '../types/index.js';

export interface PinPatch {
  pin_order: number | null;
  pin_color?: string | null;
  pin_icon?: string | null;
  kind?: 'PIECE' | 'POIDS' | 'LIBRE';
  price_per_kg_ct?: number | null;
  track_stock?: 0 | 1 | null;
  pinned_until?: string | null;
}

export interface PinResult {
  id: number;
  pin_order: number | null;
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

function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Ordered, expiry-filtered pinned rows — native first, loopback fallback. */
export async function fetchPinnedProducts(today = todayStr()): Promise<Product[] | null> {
  const native = await invokeNative<Product[]>('product_pinned', { today });
  if (Array.isArray(native)) return native;
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/products/pinned`, {
      headers: token ? { 'x-baraka-loopback': token } : {},
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as Product[];
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/** Pin/unpin one article — native first, loopback fallback. Null = both lanes down. */
export async function setPinLane(id: number, pin: PinPatch): Promise<PinResult | null> {
  const native = await invokeNative<PinResult>('product_set_pin', { id, pin });
  if (native && native.id === id) return native;
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/products/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
      body: JSON.stringify({ id, pin }),
    });
    if (!r.ok) return null;
    return (await r.json()) as PinResult;
  } catch {
    return null;
  }
}

/**
 * Overlay DB pin fields onto the UI catalog by id. Articles missing from the
 * lane keep their cached pins (offline); lanes never delete UI rows.
 */
export function mergePinsInto(products: Product[], pins: Product[]): Product[] {
  if (pins.length === 0) return products;
  const byId = new Map(pins.map((p) => [p.id, p as unknown as {
    pin_order?: number | null; pin_color?: string | null; pin_icon?: string | null;
    kind?: 'PIECE' | 'POIDS' | 'LIBRE'; price_per_kg_ct?: number | null;
    tare_g?: number; track_stock?: number | null; pinned_until?: string | null;
  }]));
  let changed = false;
  const out = products.map((p) => {
    const lane = byId.get(p.id);
    if (!lane) return p;
    changed = true;
    return {
      ...p,
      pin_order: lane.pin_order ?? null,
      pin_color: lane.pin_color ?? null,
      pin_icon: lane.pin_icon ?? null,
      kind: lane.kind ?? p.kind ?? 'PIECE',
      price_per_kg: lane.price_per_kg_ct != null ? lane.price_per_kg_ct / 100 : p.price_per_kg,
      tare_g: lane.tare_g ?? p.tare_g,
      track_stock: lane.track_stock != null ? lane.track_stock === 1 : p.track_stock,
      pinned_until: lane.pinned_until ?? null,
    };
  });
  return changed ? out : products;
}
