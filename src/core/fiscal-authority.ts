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
  input: AuthoritySettlementInput,
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

/** Row identity shared by both commit lanes (Rust requires `id`; the TS
 * lane adopts a provided one). crypto.randomUUID with a timestamp fallback. */
export function mintRowId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch { /* legacy webview — fall through */ }
  return `row-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

async function invokeLane<T>(
  command: 'record_sale' | 'record_settlement' | 'next_invoice' | 'void_sale' | 'daily_z' | 'z_close' | 'backup_db',
  args: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    const r = (await mod.invoke(command, args)) as T | null;
    return r ?? null;
  } catch {
    return null;
  }
}

/**
 * T4b (ADR-026): native-first sale commit. Inside the Tauri shell the Rust
 * fiscal lane owns the write (re-validated, seq-owned, idempotent) — zero
 * loopback hops. Everywhere else (browser preview, dev, loopback down) the
 * loopback POST applies. Null when neither lane answers → the caller queues
 * provisional + outbox, exactly as before.
 */
export async function commitSale(
  header: AuthorityHeaderInput,
  items: AuthorityItemInput[],
): Promise<{ id: string; invoice_number: string; ticket_number: string } | null> {
  const h = header.id ? header : { ...header, id: mintRowId() };
  const native = await invokeLane<{ id?: string; invoice_number?: string; ticket_number?: string }>(
    'record_sale', { header: h, items },
  );
  if (native && native.id && native.invoice_number && native.ticket_number) {
    return { id: native.id, invoice_number: native.invoice_number, ticket_number: native.ticket_number };
  }
  if (isTauriRuntime()) return null; // exe lane: Rust refused — never silently downgrade to provisional+loopback
  return postSaleToLoopback(h, items);
}

export interface AuthoritySettlementInput {
  id?: string;
  client_id: number; client_name?: string; amount_ct: number;
  payment_method: 'ESPECES' | 'CIB' | 'DAHABIYA' | 'CREDIT';
  timbre_ct: number; total_collected_ct: number;
  client_settlement_key?: string | null; date?: string; note?: string | null;
}

/** T4b (ADR-026): native-first settlement commit (same lane order as sales). */
export async function commitSettlement(
  input: AuthoritySettlementInput,
): Promise<{ id: string; receipt_number: string } | null> {
  const inp = input.id ? input : { ...input, id: mintRowId() };
  const native = await invokeLane<{ id?: string; receipt_number?: string }>(
    'record_settlement', { input: inp },
  );
  if (native && native.id && native.receipt_number) {
    return { id: native.id, receipt_number: native.receipt_number };
  }
  if (isTauriRuntime()) return null;
  return postSettlementToLoopback(inp);
}

/**
 * #003 (Phase A): native-first legal void. Inside the shell the Rust lane
 * flips the row + journals the reason (no DELETE) — zero loopback hops.
 * Browser lane POSTs to the loopback void endpoint. Tauri + native refusal
 * => null (never silently downgrade the legal journal to provisional).
 */
export async function commitVoid(
  saleId: string, reason: string, by: string,
): Promise<{ id: string; status: 'CANCELLED' } | null> {
  const native = await invokeLane<{ id?: string; status?: string }>(
    'void_sale', { saleId, reason, voidedBy: by },
  );
  if (native && native.id && native.status === 'CANCELLED') {
    return { id: native.id, status: 'CANCELLED' };
  }
  if (isTauriRuntime()) return null;
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/sales/${encodeURIComponent(saleId)}/void`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ reason, by }),
    });
    if (!r.ok) return null;
    return { id: saleId, status: 'CANCELLED' };
  } catch {
    return null;
  }
}

/**
 * #003 (Phase A): native-first hot snapshot. exe lane VACUUMs INTO the
 * sibling file; browser lane uses the loopback backup endpoint.
 */
export async function backupDatabase(
  dest: string,
): Promise<{ path: string; bytes: number | null } | null> {
  const native = await invokeLane<{ path?: string; bytes?: number }>(
    'backup_db', { dest },
  );
  if (native && native.path && typeof native.bytes === 'number') {
    return { path: native.path, bytes: native.bytes };
  }
  if (isTauriRuntime()) return null;
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ dest }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { dest?: string };
    return { path: typeof j.dest === 'string' ? j.dest : dest, bytes: null };
  } catch {
    return null;
  }
}

/**
 * #003 (Phase A): native-first day summary for the Z lane (read-only).
 * Browser lane returns null — local sales state owns the preview there.
 * #004 adds `closed`: true when a legal DAY close freezes the day.
 */
export async function fetchDailyZ(
  day: string,
): Promise<{ day: string; sales_count: number; total_ttc_ct: number; voids_count: number; closed: boolean } | null> {
  const native = await invokeLane<{ day?: string; sales_count?: number; total_ttc_ct?: number; voids_count?: number; closed?: boolean }>(
    'daily_z', { day },
  );
  if (
    native && native.day === day && typeof native.sales_count === 'number'
    && typeof native.total_ttc_ct === 'number' && typeof native.voids_count === 'number'
  ) {
    return { day, sales_count: native.sales_count, total_ttc_ct: native.total_ttc_ct, voids_count: native.voids_count, closed: native.closed === true };
  }
  return null;
}

/** #004: legal-close totals, same shape the Z view already builds. */
export interface ZCloseTotals {
  salesCount: number; totalHtCt: number; tva0BaseCt: number; tva9BaseCt: number;
  tva9AmtCt: number; tva19BaseCt: number; tva19AmtCt: number; totalTvaCt: number;
  totalTimbreCt: number; totalTtcCt: number; especesGrossCt: number; cibTotalCt: number;
  dahabiyaTotalCt: number; creditGrantedCt: number; creditCollectedCt: number;
  firstInvoice: string; lastInvoice: string;
}

/**
 * #004 (Phase A): native-first legal day close. Inside the shell the Rust
 * lane recomputes from its own ledger (caller totals are not trusted there),
 * locks the day and chains the hash — zero loopback hops. Everywhere else
 * the loopback POST applies; the server verifies the totals against ITS
 * ledger and refuses mismatches and duplicate closes. Tauri + native refusal
 * => null (the day is NOT closed — never fake a legal lock).
 */
export async function commitZClose(
  day: string, openingTime: string, closingTime: string, totals: ZCloseTotals,
): Promise<{ report_number: string; hash: string; prev_hash: string } | null> {
  const native = await invokeLane<{ report_number?: string; hash?: string; prev_hash?: string }>(
    'z_close', { day, opening_time: openingTime, closing_time: closingTime },
  );
  if (native && native.report_number && native.hash && native.prev_hash) {
    return { report_number: native.report_number, hash: native.hash, prev_hash: native.prev_hash };
  }
  if (isTauriRuntime()) return null;
  try {
    const token = await getLoopbackToken();
    const r = await fetch(`${LOOPBACK_BASE}/api/z/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ day, openingTime, closingTime, totals }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { report_number?: string; hash?: string; prev_hash?: string };
    if (j.report_number && j.hash && j.prev_hash) {
      return { report_number: j.report_number, hash: j.hash, prev_hash: j.prev_hash };
    }
    return null;
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
