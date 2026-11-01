/**
 * Baraka Market — Fiscal authority bridge (Gate-02 TASK 1).
 * Detects the native Tauri shell / local SQLite loopback and routes sale
 * commits to the authoritative WAL database. Browser-only contexts stay on
 * the provisional lane (amber NON-FISCAL banner).
 *
 * Authority order: Tauri invoke('db_status') -> loopback /api/health.
 * Either success => FISCAL_SQLITE (green MODE FISCAL ACTIF badge).
 *
 * @module core/fiscal-authority
 */

export type AuthorityStatus = 'FISCAL_SQLITE' | 'PROVISIONAL';

export const LOOPBACK_BASE = 'http://127.0.0.1:3100';
export const CASHIER_PIN_KEY = 'baraka_cashier_pin_v1';
export const DEFAULT_CASHIER_PIN = '1234';

/** 4-digit cashier PIN (localStorage override, default 1234). */
export function getCashierPin(): string {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_CASHIER_PIN;
    const pin = localStorage.getItem(CASHIER_PIN_KEY);
    if (pin && /^\d{4}$/.test(pin)) return pin;
    return DEFAULT_CASHIER_PIN;
  } catch {
    return DEFAULT_CASHIER_PIN;
  }
}

/** True inside the Tauri native desktop shell. */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w;
}

async function invokeDbStatus(): Promise<unknown | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    return (await mod.invoke('db_status')) as unknown;
  } catch {
    return null;
  }
}

export async function probeLoopbackHealth(timeoutMs = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${LOOPBACK_BASE}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = (await r.json()) as { journal_mode?: string };
    return j.journal_mode === 'wal';
  } catch {
    return false;
  }
}

/** Resolve the current fiscal authority (Tauri invoke first, loopback second). */
export async function probeFiscalAuthority(): Promise<AuthorityStatus> {
  const viaInvoke = await invokeDbStatus();
  if (viaInvoke && typeof viaInvoke === 'object') return 'FISCAL_SQLITE';
  if (await probeLoopbackHealth()) return 'FISCAL_SQLITE';
  return 'PROVISIONAL';
}

export interface AuthorityItemInput {
  product_id: number | null;
  barcode: string;
  name_fr: string;
  name_ar: string;
  unit_price_ct: number;
  qty_milli: number;
  unit: 'PIECE' | 'KG' | 'LITRE';
  tva_rate: 0 | 9 | 19;
  discount_bp: number;
  line_ht_ct: number;
  line_tva_ct: number;
  line_ttc_ct: number;
}

export interface AuthorityHeaderInput {
  id?: string;
  cashier_id: string;
  cashier_name: string;
  client_id?: number | null;
  client_name?: string | null;
  payment_method: 'ESPECES' | 'CIB' | 'DAHABIYA' | 'CREDIT';
  amount_paid_ct: number;
  amount_returned_ct: number;
  totals: {
    total_ht_ct: number;
    total_tva_ct: number;
    timbre_ct: number;
    total_ttc_ct: number;
    tva_breakdown: Record<0 | 9 | 19, { base_ht_ct: number; tva_amount_ct: number; total_ttc_ct: number }>;
  };
  is_facture?: number;
  created_at?: string;
  /** T1 slice B (ADR-022): checkout-minted idempotency key, stable across retries. */
  client_sale_id?: string | null;
}

/** T4 (ADR-025): loopback write token, relayed by the native shell via
 * invoke('loopback_token'). Cached in module memory only — never persisted.
 * Null outside Tauri (browser preview) or before the server mints it. */
let cachedToken: string | null | undefined;
export async function getLoopbackToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  if (!isTauriRuntime()) { cachedToken = null; return null; }
  try {
    const mod = await import('@tauri-apps/api/core');
    const t = (await mod.invoke('loopback_token')) as unknown;
    cachedToken = typeof t === 'string' && t.length >= 16 ? t : null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { 'x-baraka-loopback': token } : {};
}

/**
 * POST a computed sale to the authoritative SQLite lane.
 * @returns authoritative {id, invoice_number, ticket_number} or null.
 */
export async function postSaleToLoopback(
  header: AuthorityHeaderInput,
  items: AuthorityItemInput[],
  timeoutMs = 4000,
): Promise<{ id: string; invoice_number: string; ticket_number: string } | null> {
  try {
    const token = await getLoopbackToken();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${LOOPBACK_BASE}/api/sales`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ header, items }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return (await r.json()) as { id: string; invoice_number: string; ticket_number: string };
  } catch {
    return null;
  }
}

/** T2b (ADR-024): POST a debt settlement to the authoritative lane.
 * @returns authoritative {id, receipt_number} or null. Idempotent by
 * client_settlement_key (server slice). */
export async function postSettlementToLoopback(
  input: {
    client_id: number; client_name?: string; amount_ct: number;
    payment_method: 'ESPECES' | 'CIB' | 'DAHABIYA' | 'CREDIT';
    timbre_ct: number; total_collected_ct: number;
    client_settlement_key?: string | null; date?: string; note?: string | null;
  },
  timeoutMs = 4000,
): Promise<{ id: string; receipt_number: string } | null> {
  try {
    const token = await getLoopbackToken();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${LOOPBACK_BASE}/api/settlements`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return (await r.json()) as { id: string; receipt_number: string };
  } catch {
    return null;
  }
}

/** Fire-and-forget 5-byte drawer-kick via the raw-print spool endpoint. */
export async function kickDrawerViaLoopback(): Promise<void> {
  try {
    const token = await getLoopbackToken();
    void fetch(`${LOOPBACK_BASE}/api/raw-print`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ hex: '1b700019fa', label: 'drawer-kick' }),
    }).catch(() => {});
  } catch {
    /* loopback absent (browser-only lane): CSS spooler remains */
  }
}
