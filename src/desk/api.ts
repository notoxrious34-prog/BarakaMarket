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
  auditCount: number;
  lastIssueTs: string | null;
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

export interface V2Info {
  tier: 'PERP' | 'SUPPORT12';
  exp: number | null;
  maxVer: string | null;
  hwid2: string | null;
}

export interface V2Opts {
  tier?: string;
  expires?: string;
  maxVer?: string;
  hwid2?: string;
}

export interface GenerateResult {
  store: string;
  hwid: string;
  key: string;
  seq: number;
  ts: string;
  priceDzd: number;
  meta: GenerateMeta | null;
  format: 'v1' | 'v2';
  v2: V2Info | null;
}

export interface VerifyResult {
  store: string;
  hwid: string | null;
  valid: boolean;
  format: 'v1' | 'v2' | null;
  tier?: 'PERP' | 'SUPPORT12';
  slot?: 1 | 2;
  expired?: boolean;
  maxVer?: string | null;
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
  netIssued: number;
  netRevenueDzd: number;
  priceDzd: number;
  count: number;
  brokenAt: number | null;
}

export interface AuditEntryDto {
  ts: string;
  action: 'generate' | 'verify' | 'revoke' | 'unlock' | 'transfer';
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

export interface TransferResult {
  store: string;
  oldSeq: number;
  newHwid: string;
  revokeSeq: number;
  issue: { key: string; seq: number; ts: string };
  priceDzd: number;
  format: 'v1' | 'v2';
  v2: V2Info | null;
}

export interface UnlockResult {
  code: string;
  hwid: string;
  scope: 'tamper' | 'drift' | 'emergency';
  counter: number;
  exp: number;
}

export const deskApi = {
  health: () => call<DeskHealth>('/api/desk/health'),
  hwid: () => call<DeskHwid>('/api/desk/hwid'),
  generate: (store: string, hwid: string, meta?: GenerateMeta, force?: boolean, format?: 'v1' | 'v2', v2?: V2Opts) =>
    call<GenerateResult>('/api/desk/generate', {
      method: 'POST',
      body: JSON.stringify({ store, hwid, meta, force, format, v2 }),
    }),
  transfer: (oldSeq: number, newHwid: string, opts?: { force?: boolean; format?: 'v1' | 'v2'; v2?: V2Opts }) =>
    call<TransferResult>('/api/desk/transfer', {
      method: 'POST',
      body: JSON.stringify({ oldSeq, newHwid, force: opts?.force, format: opts?.format, v2: opts?.v2 }),
    }),
  unlock: (hwid: string, scope: 'tamper' | 'drift' | 'emergency', days: number, counter: number) =>
    call<UnlockResult>('/api/desk/unlock/issue', {
      method: 'POST',
      body: JSON.stringify({ hwid, scope, days, counter }),
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

/** Segmented, dictation-friendly key form. v1: `AK-XXXX XXXX …`; v2: `AK2-<json groups>.<sig groups>`. */
export function groupActivationKey(key: string): string {
  const m1 = /^AK-(.+)$/.exec(key.trim());
  if (m1) {
    const chunks: string[] = [];
    for (let i = 0; i < m1[1].length; i += 4) chunks.push(m1[1].slice(i, i + 4));
    return `AK-${chunks.join(' ')}`;
  }
  const m2 = /^AK2-(.+)\.(.+)$/.exec(key.trim());
  if (m2) return `AK2-${chunk4(m2[1])} . ${chunk4(m2[2])}`;
  const m3 = /^UL-(.+)\.(.+)$/.exec(key.trim());
  if (m3) return `UL-${chunk4(m3[1])} . ${chunk4(m3[2])}`;
  return key;
}

function chunk4(s: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += 4) chunks.push(s.slice(i, i + 4));
  return chunks.join(' ');
}

/** Masked key for tables (shoulder-surfing protection): keeps the scheme prefix + last 8. */
export function maskActivationKey(key: string): string {
  const t = key.replace(/\s/g, '');
  const prefix = t.startsWith('AK2-') ? 'AK2-' : t.startsWith('UL-') ? 'UL-' : 'AK-';
  return `${prefix}••••…${t.slice(-8)}`;
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
