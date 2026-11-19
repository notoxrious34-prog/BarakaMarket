/**
 * Baraka Market — Client identity bridge (F4, v1.8.4).
 * One-way profile mirror: UI (localStorage) -> active fiscal lane, so the
 * lane knows every client BEFORE a CREDIT commit. Balance never crosses —
 * the lane owns the ledger (sale/settlement/void postings only).
 * Exe lane: Tauri `client_upsert`. Browser lane: loopback POST (tokened).
 * All failures are silent-false — the commit refuses loudly with the reason.
 *
 * @module core/client-authority
 */
import type { Client } from '../types/index.js';
import { isTauriRuntime, LOOPBACK_BASE, getLoopbackToken } from './fiscal-authority.js';

export interface MirrorClientPayload {
  id: number; name: string; phone: string; address: string;
  nif: string | null; nis: string | null; rc: string | null; ai: string | null;
  max_credit_limit_ct: number; notes: string | null;
}

/** Pure mapping UI Client -> lane mirror row (centimes, rounded). */
export function toMirrorClient(c: Client): MirrorClientPayload {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone ?? '',
    address: c.address ?? '',
    nif: c.nif ?? null,
    nis: c.nis ?? null,
    rc: c.rc ?? null,
    ai: c.ai ?? null,
    max_credit_limit_ct: Math.round((c.max_credit_limit ?? 0) * 100),
    notes: c.notes ?? null,
  };
}

/**
 * Push ONE client profile to the active lane. Returns true when the lane
 * acknowledges; false when there is no lane (or it refuses) — the caller
 * proceeds anyway, the commit surfaces the reason.
 */
export async function upsertClientMirror(c: Client): Promise<boolean> {
  const payload = toMirrorClient(c);
  if (!Number.isInteger(payload.id) || payload.id <= 0) return false;
  if (!payload.name.trim()) return false;
  if (isTauriRuntime()) {
    try {
      const mod = await import('@tauri-apps/api/core');
      const r = await mod.invoke('client_upsert', { client: payload }) as { id?: number } | null;
      return !!r && r.id === payload.id;
    } catch {
      return false;
    }
  }
  try {
    const token = await getLoopbackToken();
    if (!token) return false;
    const r = await fetch(`${LOOPBACK_BASE}/api/clients/upsert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-baraka-loopback': token },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Push the whole UI client registry to the active lane (once per session —
 * the caller guards with a ref). Returns synced/failed counts.
 */
export async function syncClientsMirror(clients: Client[]): Promise<{ synced: number; failed: number }> {
  let synced = 0, failed = 0;
  for (const c of clients) {
    if (c.id === 1) continue; // Passager walk-in: never a ledger identity
    if (await upsertClientMirror(c)) synced += 1;
    else failed += 1;
  }
  return { synced, failed };
}
