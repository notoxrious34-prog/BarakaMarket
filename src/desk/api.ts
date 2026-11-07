/**
 * Baraka Activation Desk — browser API client (staff station).
 * The private key never reaches the browser: signing happens in
 * `server/desk.ts` (localhost only). This module only shapes requests.
 *
 * @module desk/api
 */

export interface DeskHealth {
  ok: boolean;
  version: string;
  keyLoaded: boolean;
  keySource: string;
  keyPermWarn: string | null;
  ledgerCount: number;
  ledgerBrokenAt: number | null;
  backupCount: number;
  priceDzd: number;
}

export interface DeskHwid {
  hwid: string;
}

export interface GenerateMeta {
  phone?: string;
  wilaya?: string;
  paidDzd?: number;
  note?: string;
}

export interface GenerateResult {
  store: string;
  hwid: string;
  key: string;
  seq: number;
  ts: string;
  priceDzd: number;
  meta: GenerateMeta | null;
}

export interface VerifyResult {
  store: string;
  hwid: string | null;
  valid: boolean;
}

export interface LedgerEntryDto {
  seq: number;
  ts: string;
  kind: 'issue' | 'revoke';
  store: string;
  hwid: string;
  key: string;
  note: string;
  prev: string;
  hash: string;
  meta?: GenerateMeta;
  revokes?: number;
}

export interface LedgerResult {
  entries: LedgerEntryDto[];
  count: number;
  brokenAt: number | null;
  priceDzd: number;
}

export interface DeskStats {
  issued: number;
  revoked: number;
  revenueDzd: number;
  priceDzd: number;
  count: number;
  brokenAt: number | null;
}

export interface AuditEntryDto {
  ts: string;
  action: 'generate' | 'verify' | 'revoke';
  store?: string;
  hwid?: string;
  seq?: number;
  ok: boolean;
  detail?: string;
}

export interface AuditResult {
  entries: AuditEntryDto[];
  count: number;
}

export interface LedgerCheckResult {
  count: number;
  brokenAt: number | null;
}

export class DeskApiError extends Error {
  status: number;
  /** Present on 409 duplicate refusals: the blocking active issuance. */
  existingSeq?: number;
  constructor(status: number, msg: string, existingSeq?: number) {
    super(msg);
    this.status = status;
    this.existingSeq = existingSeq;
  }
}

const TOKEN_KEY = 'baraka-desk-token';

export function getDeskToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setDeskToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token.trim());
  } catch { /* private mode — the token simply won't persist */ }
}

export function clearDeskToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* noop */ }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;
/** The UI registers a handler that opens the unlock screen on 401. */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  unauthorizedHandler = fn;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getDeskToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-baraka-desk': token } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; existingSeq?: number } & T;
  if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
  if (!res.ok) {
    throw new DeskApiError(
      res.status,
      body.error ?? `طلب فشل (${res.status})`,
      typeof body.existingSeq === 'number' ? body.existingSeq : undefined,
    );
  }
  return body as T;
}

export const deskApi = {
  health: () => call<DeskHealth>('/api/desk/health'),
  hwid: () => call<DeskHwid>('/api/desk/hwid'),
  generate: (store: string, hwid: string, meta?: GenerateMeta, force?: boolean) =>
    call<GenerateResult>('/api/desk/generate', {
      method: 'POST',
      body: JSON.stringify({ store, hwid, meta, force }),
    }),
  verify: (store: string, hwid: string, key: string) =>
    call<VerifyResult>('/api/desk/verify', {
      method: 'POST',
      body: JSON.stringify({ store, hwid, key }),
    }),
  ledger: (last = 500) => call<LedgerResult>(`/api/desk/ledger?last=${last}`),
  revoke: (seq: number) =>
    call<{ marker: LedgerEntryDto }>('/api/desk/ledger/revoke', {
      method: 'POST',
      body: JSON.stringify({ seq }),
    }),
  ledgerCheck: (text: string) =>
    call<LedgerCheckResult>('/api/desk/ledger/check', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  audit: (last = 200) => call<AuditResult>(`/api/desk/audit?last=${last}`),
  stats: () => call<DeskStats>('/api/desk/stats'),
};

/** Segmented, dictation-friendly key form: `AK-XXXX XXXX …` (groups of 4). */
export function groupActivationKey(key: string): string {
  const m = /^AK-(.+)$/.exec(key.trim());
  if (!m) return key;
  const chunks: string[] = [];
  for (let i = 0; i < m[1].length; i += 4) chunks.push(m[1].slice(i, i + 4));
  return `AK-${chunks.join(' ')}`;
}

/** Masked key for tables (shoulder-surfing protection): `AK-••••…last8`. */
export function maskActivationKey(key: string): string {
  const tail = key.replace(/\s/g, '').slice(-8);
  return `AK-••••…${tail}`;
}

/** WhatsApp/SMS message the operator forwards to the shopkeeper. */
export function buildShopMessage(store: string, key: string): string {
  return `سلام، مفتاح تفعيل Baraka Market لمحل "${store}": ${key} — الصقه في الإعدادات ← الترخيص ← تفعيل.`;
}

/** Copy text with a legacy fallback (non-secure contexts, old WebViews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
