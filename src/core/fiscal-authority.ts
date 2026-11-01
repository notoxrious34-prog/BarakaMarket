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
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${LOOPBACK_BASE}/api/sales`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

/** Fire-and-forget 5-byte drawer-kick via the raw-print spool endpoint. */
export function kickDrawerViaLoopback(): void {
  try {
    void fetch(`${LOOPBACK_BASE}/api/raw-print`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hex: '1b700019fa', label: 'drawer-kick' }),
    }).catch(() => {});
  } catch {
    /* loopback absent (browser-only lane): CSS spooler remains */
  }
}
