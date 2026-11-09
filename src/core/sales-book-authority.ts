/**
 * Baraka Market — Sales book authority (v1.5.2, P1+P2).
 * The receipt-level bridge between POS and journal/Z: list one business day,
 * fetch a receipt head + returnable lines, record a governed duplicata.
 * Reads ride the open loopback lane (same as listReturns/listClaims);
 * the duplicata audit POST carries the loopback token.
 *
 * @module core/sales-book-authority
 */
import { LOOPBACK_BASE, getLoopbackToken } from './fiscal-authority.js';
import { lookupReturnSale } from './returns-authority.js';

export interface SalesBookRow {
  id: string; invoice_number: string; ticket_number: string; created_at: string;
  cashier_name: string; payment_method: string; total_ttc_ct: number; status: string;
  client_name: string | null; has_approved_return: 0 | 1;
}

let salesBookError: string | null = null;
export function lastSalesBookError(): string | null {
  return salesBookError;
}

function isRow(v: unknown): v is SalesBookRow {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.invoice_number === 'string'
    && typeof o.created_at === 'string' && typeof o.total_ttc_ct === 'number';
}

/** Every sale of one Algiers business day (YYYY-MM-DD), newest first. */
export async function listSalesDay(day: string): Promise<SalesBookRow[] | null> {
  salesBookError = null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { salesBookError = 'bad day, want YYYY-MM-DD'; return null; }
  try {
    const r = await fetch(`${LOOPBACK_BASE}/api/sales/day/${encodeURIComponent(day)}`);
    if (!r.ok) { salesBookError = `HTTP ${r.status}`; return null; }
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j) || !j.every(isRow)) { salesBookError = 'bad day payload'; return null; }
    return j;
  } catch {
    salesBookError = 'lane unreachable';
    return null;
  }
}

/** Full receipt detail: fiscal head (every sales column) + returnable lines
 * with returned/remaining math. Two reads, zero changes to the returns lane. */
export interface SalesBookDetail {
  head: Record<string, unknown>;
  items: import('./returns-authority.js').ReturnLookupItem[];
}

export async function getSalesBookDetail(id: string): Promise<SalesBookDetail | null> {
  salesBookError = null;
  if (!id.trim()) { salesBookError = 'empty sale id'; return null; }
  try {
    const [h, lookup] = await Promise.all([
      fetch(`${LOOPBACK_BASE}/api/sales/${encodeURIComponent(id)}`),
      lookupReturnSale(id),
    ]);
    if (!h.ok) { salesBookError = h.status === 404 ? 'sale not found' : `HTTP ${h.status}`; return null; }
    const head = (await h.json()) as unknown;
    if (typeof head !== 'object' || head === null || typeof (head as Record<string, unknown>).id !== 'string') {
      salesBookError = 'bad sale head payload';
      return null;
    }
    if (!lookup) { salesBookError = 'lines unreachable'; return null; }
    return { head: head as Record<string, unknown>, items: lookup.items };
  } catch {
    salesBookError = 'lane unreachable';
    return null;
  }
}

/** Governed duplicata (P2): the audit row lands BEFORE the client prints.
 * The reprint itself opens only on true. No silent second copies. */
export async function recordDuplicata(id: string, by: string, reason?: string): Promise<boolean> {
  salesBookError = null;
  const actor = by.trim();
  if (!actor) { salesBookError = 'actor required'; return false; }
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/sales/${encodeURIComponent(id)}/duplicata`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
      body: JSON.stringify({ by: actor, reason: (reason ?? '').slice(0, 140) }),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = ((await r.json()) as { error?: string }).error ?? ''; } catch { /* text body */ }
      salesBookError = detail || `HTTP ${r.status}`;
      return false;
    }
    return true;
  } catch {
    salesBookError = 'lane unreachable';
    return false;
  }
}
