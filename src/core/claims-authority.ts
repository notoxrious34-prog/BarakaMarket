/**
 * Baraka Market — Supplier-claims authority bridge (R-bridge, v1.5.1).
 * Invoke-first, loopback fallback, null last — the same lane order as the
 * returns authority. Flag (cashier+) → settle (manager+) → avoir booked.
 * The lanes re-check every guard (role, resolution, ledger row); the view
 * only gates buttons.
 *
 * @module core/claims-authority
 */
import { isTauriRuntime, LOOPBACK_BASE, getLoopbackToken } from './fiscal-authority.js';
import type { ClaimReasonCode, ClaimResolution, ClaimStatus } from '../types/index.js';

export interface ClaimInput {
  supplier_id: number; supplier_name: string;
  product_id?: number | null;
  qty_milli: number;
  reason: ClaimReasonCode;
  note?: string;
  actor: string;
}

export interface ClaimHead {
  id: string; claim_number: string; supplier_id: number; supplier_name: string;
  product_id: number | null; product_name: string; qty_milli: number; unit: string;
  reason: ClaimReasonCode; note: string; total_cost_ct: number;
  status: ClaimStatus; resolution: string | null;
  created_by: string; created_at: string;
  decided_by: string | null; decided_at: string | null;
}

export interface QuarantineRow {
  return_number: string; invoice_number: string; reason: string; decided_at: string | null;
  name_fr: string; qty_milli: number; unit: string; product_id: number | null;
  line_ttc_ct: number;
}

let claimLaneError: string | null = null;
export function lastClaimLaneError(): string | null {
  return claimLaneError;
}

async function invokeClaimsNative<T>(command: string, args: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    return ((await mod.invoke(command, args)) as T) ?? null;
  } catch (e) {
    claimLaneError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

function isClaimOut(v: unknown): v is { id: string; claim_number: string; total_cost_ct: number } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.claim_number === 'string' && typeof o.total_cost_ct === 'number';
}

/** File a supplier claim (cashier+). */
export async function createSupplierClaim(input: ClaimInput): Promise<{ id: string; claim_number: string; total_cost_ct: number } | null> {
  claimLaneError = null;
  const args = {
    supplierId: input.supplier_id, supplierName: input.supplier_name,
    productId: input.product_id ?? null, qtyMilli: input.qty_milli,
    reason: input.reason, note: input.note ?? null, actor: input.actor,
  };
  if (isTauriRuntime()) {
    const n = await invokeClaimsNative<{ id?: unknown; claim_number?: unknown; total_cost_ct?: unknown }>('claim_create', args);
    if (isClaimOut(n)) return n;
    if (!claimLaneError) claimLaneError = 'bad claim payload';
    return null;
  }
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/claims`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
      body: JSON.stringify({
        supplier_id: input.supplier_id, supplier_name: input.supplier_name,
        product_id: input.product_id ?? null, qty_milli: input.qty_milli,
        reason: input.reason, note: input.note ?? null, actor: input.actor,
      }),
    });
    if (!r.ok) { claimLaneError = `HTTP ${r.status}`; return null; }
    const j = (await r.json()) as unknown;
    if (!isClaimOut(j)) { claimLaneError = 'bad claim payload'; return null; }
    return j;
  } catch {
    claimLaneError = 'lane unreachable';
    return null;
  }
}

/** Settle a claim (manager+). CREDIT_NOTE books the avoir on the supplier ledger. */
export async function settleSupplierClaim(id: string, resolution: ClaimResolution, decidedBy: string, decidedRole: string): Promise<boolean> {
  claimLaneError = null;
  if (isTauriRuntime()) {
    const n = await invokeClaimsNative<{ status?: unknown }>('claim_settle', {
      id, resolution, decidedBy, decidedRole,
    });
    if (n && (n as { status?: unknown }).status === 'SETTLED') return true;
    if (!claimLaneError) claimLaneError = 'settle refused';
    return false;
  }
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/claims/${encodeURIComponent(id)}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
      body: JSON.stringify({ resolution, decided_by: decidedBy, decided_role: decidedRole }),
    });
    if (!r.ok) { claimLaneError = `HTTP ${r.status}`; return false; }
    return true;
  } catch {
    claimLaneError = 'lane unreachable';
    return false;
  }
}

function isClaimList(v: unknown): v is ClaimHead[] {
  return Array.isArray(v);
}

/** List claims, optionally filtered (read-only, both lanes). */
export async function listSupplierClaims(status?: ClaimStatus): Promise<ClaimHead[] | null> {
  claimLaneError = null;
  if (isTauriRuntime()) {
    const n = await invokeClaimsNative<unknown>('claim_list', { status: status ?? null });
    if (isClaimList(n)) return n;
    if (!claimLaneError) claimLaneError = 'bad claims payload';
    return null;
  }
  try {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const r = await fetch(`${LOOPBACK_BASE}/api/claims${q}`);
    if (!r.ok) { claimLaneError = `HTTP ${r.status}`; return null; }
    const j = (await r.json()) as unknown;
    if (!isClaimList(j)) { claimLaneError = 'bad claims payload'; return null; }
    return j as ClaimHead[];
  } catch {
    claimLaneError = 'lane unreachable';
    return null;
  }
}

/** Quarantine snapshot for the supplier rep (read-only, both lanes). */
export async function listQuarantineRows(): Promise<QuarantineRow[] | null> {
  claimLaneError = null;
  if (isTauriRuntime()) {
    const n = await invokeClaimsNative<unknown>('quarantine_list', { limit: 200 });
    if (Array.isArray(n)) return n as QuarantineRow[];
    if (!claimLaneError) claimLaneError = 'bad quarantine payload';
    return null;
  }
  try {
    const r = await fetch(`${LOOPBACK_BASE}/api/quarantine`);
    if (!r.ok) { claimLaneError = `HTTP ${r.status}`; return null; }
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j)) { claimLaneError = 'bad quarantine payload'; return null; }
    return j as QuarantineRow[];
  } catch {
    claimLaneError = 'lane unreachable';
    return null;
  }
}
