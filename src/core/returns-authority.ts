/**
 * Baraka Market — Returns authority bridge (v1.5.0, B1).
 * Invoke-first, loopback fallback, null last — the same lane order as the
 * fiscal commit path and the T8 session lane. Draft (cashier+) → approve /
 * reject (manager+) → print BON DE RETOUR. The lanes re-check every guard
 * (window, two-person, session, terminal state); the view only gates buttons.
 *
 * @module core/returns-authority
 */
import { isTauriRuntime, LOOPBACK_BASE, getLoopbackToken, mintRowId } from './fiscal-authority.js';
import { fiscalDayISO } from './fiscal-day.js';
import type { ReturnReasonCode, ReturnStatus } from '../types/index.js';

export interface ReturnLookupItem {
  sale_item_id: number; product_id: number | null; barcode: string;
  name_fr: string; name_ar: string; unit_price_ct: number; qty_milli: number;
  unit: string; tva_rate: number; line_ttc_ct: number;
  returned_milli: number; remaining_milli: number;
}

export interface ReturnSaleLookup {
  sale: {
    id: string; invoice_number: string; status: string; created_at: string;
    payment_method: string; client_name: string | null; total_ttc_ct: number;
  };
  items: ReturnLookupItem[];
}

export interface ReturnDraftInput {
  sale_id: string;
  lines: { saleItemId: number; qty_milli: number }[];
  reason: ReturnReasonCode;
  reason_note?: string | null;
  actor: string;
  client_return_key?: string | null;
}

export interface ReturnHead {
  id: string; return_number: string | null; sale_id: string;
  invoice_number: string; payment_method: string; status: ReturnStatus;
  reason: ReturnReasonCode; actor: string; approver: string;
  sale_day: string; posting_day: string | null;
  refund_ct: number; created_at: string;
}

/** Last refusal reason of the returns lane. Read it right after a null
 * return — the lane never throws, mirroring the fiscal `lastLaneError`
 * pattern. */
let returnLaneError: string | null = null;
export function lastReturnLaneError(): string | null {
  return returnLaneError;
}

async function invokeReturnsNative<T>(command: string, args: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    return ((await mod.invoke(command, args)) as T) ?? null;
  } catch (e) {
    returnLaneError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

function isLookup(v: unknown): v is ReturnSaleLookup {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const s = o.sale as Record<string, unknown> | undefined;
  return !!s && typeof s.id === 'string' && typeof s.invoice_number === 'string' && Array.isArray(o.items);
}

/** Find a sale by UUID id OR FACT number (read-only, both lanes). */
export async function lookupReturnSale(key: string): Promise<ReturnSaleLookup | null> {
  returnLaneError = null;
  const k = key.trim();
  if (!k) { returnLaneError = 'empty lookup key'; return null; }
  if (isTauriRuntime()) {
    const n = await invokeReturnsNative<ReturnSaleLookup>('sale_for_return', { key: k });
    if (isLookup(n)) return n;
    // A native refusal inside the shell is final — but "not found" (null
    // JSON) is a lookup miss, not a lane failure.
    if (returnLaneError) return null;
    returnLaneError = 'sale not found';
    return null;
  }
  try {
    const r = await fetch(`${LOOPBACK_BASE}/api/sales/lookup/${encodeURIComponent(k)}`);
    if (!r.ok) { returnLaneError = r.status === 404 ? 'sale not found' : `HTTP ${r.status}`; return null; }
    const j = (await r.json()) as unknown;
    if (!isLookup(j)) { returnLaneError = 'bad lookup payload'; return null; }
    return j;
  } catch {
    returnLaneError = 'lane unreachable';
    return null;
  }
}

function isDraftOut(v: unknown): v is { id: string; refund_ct: number } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.refund_ct === 'number';
}

/** Draft a return (cashier+). Idempotent by client_return_key (checkout-minted). */
export async function createReturnDraft(input: ReturnDraftInput): Promise<{ id: string; refund_ct: number } | null> {
  returnLaneError = null;
  const inp = input.client_return_key ? input : { ...input, client_return_key: mintRowId() };
  if (isTauriRuntime()) {
    const n = await invokeReturnsNative<{ id?: unknown; refund_ct?: unknown }>('return_create', {
      saleId: inp.sale_id,
      itemsJson: JSON.stringify(inp.lines),
      reason: inp.reason,
      reasonNote: inp.reason_note ?? null,
      actor: inp.actor,
      clientKey: inp.client_return_key ?? null,
      today: fiscalDayISO(new Date()),
    });
    if (isDraftOut(n)) return n;
    if (!returnLaneError) returnLaneError = 'native lane refused';
    return null;
  }
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/returns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
      body: JSON.stringify(inp),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = ((await r.json()) as { error?: string }).error ?? ''; } catch { /* text body */ }
      returnLaneError = detail || `HTTP ${r.status}`;
      return null;
    }
    const j = (await r.json()) as unknown;
    if (!isDraftOut(j)) { returnLaneError = 'bad draft payload'; return null; }
    return j;
  } catch {
    returnLaneError = 'lane unreachable';
    return null;
  }
}

function isApproveOut(v: unknown): v is { return_number: string; refund_ct: number; posting_day: string } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.return_number === 'string' && typeof o.refund_ct === 'number' && typeof o.posting_day === 'string';
}

/** Approve a draft (manager+). Mints RET-YYYY-XXXXXX, restocks, posts the
 * cash WITHDRAWAL. Null on any refusal — read `lastReturnLaneError()`. */
export async function approveReturn(
  id: string, approver: string, approverRole: string,
): Promise<{ return_number: string; refund_ct: number; posting_day: string } | null> {
  returnLaneError = null;
  if (isTauriRuntime()) {
    const n = await invokeReturnsNative<{ return_number?: unknown; refund_ct?: unknown; posting_day?: unknown }>(
      'return_approve', { id, approver, approverRole, today: fiscalDayISO(new Date()) },
    );
    if (isApproveOut(n)) return n;
    if (!returnLaneError) returnLaneError = 'native lane refused';
    return null;
  }
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/returns/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
      body: JSON.stringify({ approver, approver_role: approverRole }),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = ((await r.json()) as { error?: string }).error ?? ''; } catch { /* text body */ }
      returnLaneError = detail || `HTTP ${r.status}`;
      return null;
    }
    const j = (await r.json()) as unknown;
    if (!isApproveOut(j)) { returnLaneError = 'bad approval payload'; return null; }
    return j;
  } catch {
    returnLaneError = 'lane unreachable';
    return null;
  }
}

/** Reject a draft (manager+, terminal, audited). True unless the lane refused. */
export async function rejectReturn(id: string, actor: string, note?: string): Promise<boolean> {
  returnLaneError = null;
  if (isTauriRuntime()) {
    const n = await invokeReturnsNative<{ id?: unknown; status?: unknown }>('return_reject', {
      id, actor, note: note ?? null,
    });
    if (n && (n as { status?: unknown }).status === 'REJECTED') return true;
    if (!returnLaneError) returnLaneError = 'native lane refused';
    return false;
  }
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/returns/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
      body: JSON.stringify({ actor, note: note ?? null }),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = ((await r.json()) as { error?: string }).error ?? ''; } catch { /* text body */ }
      returnLaneError = detail || `HTTP ${r.status}`;
      return false;
    }
    return true;
  } catch {
    returnLaneError = 'lane unreachable';
    return false;
  }
}

/** Read one return with its lines (null when unknown). */
export async function getReturn(id: string): Promise<(ReturnHead & { items: Record<string, unknown>[] }) | null> {
  returnLaneError = null;
  if (isTauriRuntime()) {
    const n = await invokeReturnsNative<Record<string, unknown> | null>('return_get', { id });
    if (n && typeof n === 'object' && typeof (n as Record<string, unknown>).id === 'string') {
      return n as unknown as ReturnHead & { items: Record<string, unknown>[] };
    }
    if (!returnLaneError) returnLaneError = 'return not found';
    return null;
  }
  try {
    const r = await fetch(`${LOOPBACK_BASE}/api/returns/${encodeURIComponent(id)}`);
    if (!r.ok) { returnLaneError = r.status === 404 ? 'return not found' : `HTTP ${r.status}`; return null; }
    return (await r.json()) as ReturnHead & { items: Record<string, unknown>[] };
  } catch {
    returnLaneError = 'lane unreachable';
    return null;
  }
}

/** List returns, optionally filtered (null when the lane is unreachable). */
export async function listReturns(status?: ReturnStatus): Promise<ReturnHead[] | null> {
  returnLaneError = null;
  if (isTauriRuntime()) {
    const n = await invokeReturnsNative<ReturnHead[]>('return_list', { status: status ?? null });
    if (Array.isArray(n)) return n;
    if (!returnLaneError) returnLaneError = 'native lane refused';
    return null;
  }
  try {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const r = await fetch(`${LOOPBACK_BASE}/api/returns${q}`);
    if (!r.ok) { returnLaneError = `HTTP ${r.status}`; return null; }
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j)) { returnLaneError = 'bad list payload'; return null; }
    return j as ReturnHead[];
  } catch {
    returnLaneError = 'lane unreachable';
    return null;
  }
}
