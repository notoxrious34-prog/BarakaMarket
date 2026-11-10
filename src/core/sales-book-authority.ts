/**
 * Baraka Market — Sales book authority (v1.5.3, P1–P4 + native lane).
 * The receipt-level bridge between POS and journal/Z: list one business day,
 * fetch a receipt head + returnable lines, record a governed duplicata,
 * filter/aggregate/export the day (pure P3/P4 helpers) and cross-check Z.
 * Invoke-first (T12 precedent): the installed shell has no loopback server,
 * so every read tries the native command and only then the loopback lane;
 * the duplicata audit POST carries the loopback token.
 *
 * @module core/sales-book-authority
 */
import { LOOPBACK_BASE, getLoopbackToken, isTauriRuntime } from './fiscal-authority.js';
import { lookupReturnSale } from './returns-authority.js';

/** Native lane for the installed shell (null outside Tauri — T12 pattern). */
async function invokeBookNative<T>(command: string, args: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    return ((await mod.invoke(command, args)) as T) ?? null;
  } catch {
    return null;
  }
}

export interface SalesBookRow {
  id: string; invoice_number: string; ticket_number: string; created_at: string;
  cashier_name: string; payment_method: string; total_ttc_ct: number; status: string;
  client_name: string | null; has_approved_return: 0 | 1;
  /** P3: approved AVOIR posted against this sale (TTC). Absent on old lanes → 0. */
  avoir_total_ct?: number;
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

/** Every sale of one Algiers business day (YYYY-MM-DD), newest first.
 * Invoke-first: native `sales_book_day` in the installed shell, loopback
 * lane in dev/browser. */
export async function listSalesDay(day: string): Promise<SalesBookRow[] | null> {
  salesBookError = null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { salesBookError = 'bad day, want YYYY-MM-DD'; return null; }
  try {
    const native = await invokeBookNative<{ rows: unknown }>('sales_book_day', { day });
    if (native && Array.isArray(native.rows)) {
      if (!native.rows.every(isRow)) { salesBookError = 'bad day payload'; return null; }
      return native.rows as SalesBookRow[];
    }
    if (isTauriRuntime()) { salesBookError = 'lane unreachable'; return null; }
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

/** P3 — client-side filters over one day's rows (pure, fully tested).
 * The day payload stays bounded (hundreds of receipts); filtering in memory
 * keeps the server surface minimal and the behaviour deterministic. */
export interface SalesBookFilters {
  /** FACT / ticket substring, digits tolerated (e.g. "42", "FACT-2026-000042"). */
  q: string;
  cashier: string;
  pay: '' | 'ESPECES' | 'CIB' | 'DAHABIYA' | 'CREDIT';
  /** '' = all, 'avoir' = has APPROVED return, 'cancelled' = CANCELLED rows. */
  flag: '' | 'avoir' | 'cancelled';
  /** '' = all, 'named' = registered client, 'walkin' = no client. */
  client: '' | 'named' | 'walkin';
}

export const EMPTY_SALES_BOOK_FILTERS: SalesBookFilters = { q: '', cashier: '', pay: '', flag: '', client: '' };

export function filterSalesBookRows(rows: SalesBookRow[], f: SalesBookFilters): SalesBookRow[] {
  const q = f.q.trim().toUpperCase().replace(/\s+/g, '');
  return rows.filter(r => {
    if (q && !(`${r.invoice_number} ${r.ticket_number}`.toUpperCase().replace(/\s+/g, '').includes(q))) return false;
    if (f.cashier && r.cashier_name !== f.cashier) return false;
    if (f.pay && r.payment_method !== f.pay) return false;
    if (f.flag === 'avoir' && r.has_approved_return !== 1) return false;
    if (f.flag === 'cancelled' && r.status !== 'CANCELLED') return false;
    if (f.client === 'named' && !r.client_name) return false;
    if (f.client === 'walkin' && r.client_name) return false;
    return true;
  });
}

export function salesBookCashiers(rows: SalesBookRow[]): string[] {
  return [...new Set(rows.map(r => r.cashier_name).filter(Boolean))].sort();
}

/** P4 — day health (pure): gross, AVOIR, net, cancelled, per-method split.
 * CANCELLED rows are counted apart, never inside the gross (fiscal hygiene). */
export interface SalesBookHealth {
  count: number; cancelled: number;
  gross_ct: number; avoir_ct: number; net_ct: number;
  especes_ct: number; bank_ct: number; credit_ct: number;
}

export function computeSalesBookHealth(rows: SalesBookRow[]): SalesBookHealth {
  const h: SalesBookHealth = { count: 0, cancelled: 0, gross_ct: 0, avoir_ct: 0, net_ct: 0, especes_ct: 0, bank_ct: 0, credit_ct: 0 };
  for (const r of rows) {
    if (r.status === 'CANCELLED') { h.cancelled += 1; continue; }
    h.count += 1;
    h.gross_ct += r.total_ttc_ct;
    h.avoir_ct += r.avoir_total_ct ?? 0;
    if (r.payment_method === 'ESPECES') h.especes_ct += r.total_ttc_ct;
    else if (r.payment_method === 'CIB' || r.payment_method === 'DAHABIYA') h.bank_ct += r.total_ttc_ct;
    else if (r.payment_method === 'CREDIT') h.credit_ct += r.total_ttc_ct;
  }
  h.net_ct = h.gross_ct - h.avoir_ct;
  return h;
}

/** P4 — official Z-side day totals (same Algiers window, COMPLETED only).
 * The health card nets against this: equal gross ⇒ the book matches accounting. */
export interface ZDaySummary {
  sales_count: number; total_ttc_ct: number; total_especes_ct: number;
  total_bank_ct: number; total_credit_granted_ct: number;
}

function isZSummary(v: unknown): v is ZDaySummary {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.sales_count === 'number' && typeof o.total_ttc_ct === 'number';
}

export async function fetchZDaySummary(day: string): Promise<ZDaySummary | null> {
  salesBookError = null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { salesBookError = 'bad day, want YYYY-MM-DD'; return null; }
  try {
    const native = await invokeBookNative<{ z: unknown }>('sales_book_day', { day });
    if (native && isZSummary(native.z)) return native.z;
    if (isTauriRuntime()) { salesBookError = 'lane unreachable'; return null; }
    const r = await fetch(`${LOOPBACK_BASE}/api/z/summary?date=${encodeURIComponent(day)}`);
    if (!r.ok) { salesBookError = `HTTP ${r.status}`; return null; }
    const j = (await r.json()) as unknown;
    if (!isZSummary(j)) { salesBookError = 'bad z payload'; return null; }
    return j;
  } catch {
    salesBookError = 'lane unreachable';
    return null;
  }
}

/** P3 — CSV export (pure): semicolon FR/AR headers + BOM, same convention
 * as the audit-timeline exporter. One line per receipt, amounts in DZD. */
export function buildSalesBookCsv(rows: SalesBookRow[], day: string, lang: 'ar' | 'fr'): string {
  const dzd = (ct: number) => (ct / 100).toFixed(2).replace('.', ',');
  const head = lang === 'ar'
    ? 'الوصل;التذكرة;الساعة;الكاشير;الدفع;الزبون;المجموع (دج);AVOIR (دج);الحالة'
    : 'Facture;Ticket;Heure;Caissier;Paiement;Client;Total (DZD);AVOIR (DZD);Statut';
  const esc = (v: string | null) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map(r => [
    esc(r.invoice_number), esc(r.ticket_number), esc(r.created_at.slice(11, 16)),
    esc(r.cashier_name), esc(r.payment_method), esc(r.client_name ?? (lang === 'ar' ? 'عابر' : 'Passage')),
    dzd(r.total_ttc_ct), dzd(r.avoir_total_ct ?? 0), esc(r.status),
  ].join(';'));
  return `﻿${head}\n${lines.join('\n')}\n`;
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
    // Head: native `sale_head` first in the shell (no loopback there).
    let head: unknown = await invokeBookNative<Record<string, unknown>>('sale_head', { id });
    if (head && (typeof head !== 'object' || typeof (head as Record<string, unknown>).id !== 'string')) {
      salesBookError = 'bad sale head payload';
      return null;
    }
    if (!head) {
      if (isTauriRuntime()) { salesBookError = 'lane unreachable'; return null; }
      const h = await fetch(`${LOOPBACK_BASE}/api/sales/${encodeURIComponent(id)}`);
      if (!h.ok) { salesBookError = h.status === 404 ? 'sale not found' : `HTTP ${h.status}`; return null; }
      head = (await h.json()) as unknown;
      if (typeof head !== 'object' || head === null || typeof (head as Record<string, unknown>).id !== 'string') {
        salesBookError = 'bad sale head payload';
        return null;
      }
    }
    const lookup = await lookupReturnSale(id);
    if (!lookup) { salesBookError = 'lines unreachable'; return null; }
    return { head: head as Record<string, unknown>, items: lookup.items };
  } catch {
    salesBookError = 'lane unreachable';
    return null;
  }
}

/** Governed duplicata (P2): the audit row lands BEFORE the client prints.
 * The reprint itself opens only on true. No silent second copies.
 * Invoke-first: native `sale_duplicata` in the shell (invoke IS the auth
 * boundary — no token needed there); loopback POST with token otherwise. */
export async function recordDuplicata(id: string, by: string, reason?: string): Promise<boolean> {
  salesBookError = null;
  const actor = by.trim();
  if (!actor) { salesBookError = 'actor required'; return false; }
  try {
    const native = await invokeBookNative<{ ok: boolean }>(
      'sale_duplicata', { id, by: actor, reason: (reason ?? '').slice(0, 140) },
    );
    if (native) return native.ok === true;
    if (isTauriRuntime()) { salesBookError = 'lane unreachable'; return false; }
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
