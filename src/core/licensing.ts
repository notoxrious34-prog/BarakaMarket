/**
 * Baraka Market — BarakaLock air-gapped licensing (Gate-03 TASK 3).
 * Zero internet: deterministic HWID + HMAC-SHA256 activation keys, all
 * arithmetic string-based, no floating point anywhere near the license path.
 *
 * @module core/licensing
 */
import { sha256Hex, hmacSha256Hex } from './sha256';

/** Offline secret seed — baked into the binary, never transmitted. */
export const BARAKA_SECRET = 'BARAKA_MARKET_SECRET_ALGERIA_2026';

/** Retail price anchor (DZD) — informational, enforced by sales policy. */
export const LICENSE_PRICE_DZD = 5000;

/** Trial envelope: 50 sales or 14 days, whichever hits first. */
export const TRIAL_MAX_SALES = 50;
export const TRIAL_MAX_DAYS = 14;

export type LicenseStatus = 'TRIAL' | 'ACTIVATED';

export interface MachineParts {
  arch: string;
  hostname: string;
  osVersion: string;
  screen: string;
  seed: string;
}

const GROUP = (hex16: string, prefix: string): string =>
  `${prefix}-${hex16.slice(0, 4)}-${hex16.slice(4, 8)}-${hex16.slice(8, 12)}-${hex16.slice(12, 16)}`.toUpperCase();

/**
 * Deterministic machine fingerprint → BM-XXXX-XXXX-XXXX-XXXX.
 * Stable for a given machine+seed; no admin/network permissions needed.
 */
export function computeHwid(parts: MachineParts): string {
  const digest = sha256Hex(
    [parts.arch, parts.hostname, parts.osVersion, parts.screen, parts.seed].join('|'),
  );
  return GROUP(digest.slice(0, 16), 'BM');
}

/** Browser-lane fingerprint collection (best-effort, seed carries stability). */
export function collectBrowserFingerprint(seed: string): MachineParts {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const uaData = (nav as unknown as { userAgentData?: { platform?: string } } | undefined)?.userAgentData;
  return {
    arch: uaData?.platform ?? (nav?.platform || 'unknown'),
    hostname: 'browser-pos',
    osVersion: nav?.userAgent || 'unknown',
    screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : '0x0',
    seed,
  };
}

/** Node-lane fingerprint (loopback/CLI): os+hostname backed. */
export function collectNodeFingerprint(seed: string, os: { arch(): string; hostname(): string; release(): string }): MachineParts {
  return {
    arch: os.arch(),
    hostname: os.hostname(),
    osVersion: os.release(),
    screen: 'headless',
    seed,
  };
}

/** Activation key: AK-XXXX-XXXX-XXXX-XXXX = first 16 hex of HMAC-SHA256(store||hwid). */
export function generateActivationKey(storeName: string, hwid: string): string {
  const sig = hmacSha256Hex(BARAKA_SECRET, `${storeName.trim()}||${hwid.trim().toUpperCase()}`);
  return GROUP(sig.slice(0, 16), 'AK');
}

/** Timing-safe string compare (length + char walk, no early length leak of note here). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Offline validation — pure function, zero I/O. */
export function validateLicense(storeName: string, hwid: string, key: string): boolean {
  const norm = key.trim().toUpperCase();
  if (!/^AK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(norm)) return false;
  return safeEqual(generateActivationKey(storeName, hwid), norm);
}

export interface TrialState {
  status: LicenseStatus;
  salesUsed: number;
  salesRemaining: number;
  daysUsed: number;
  daysRemaining: number;
}

/** Trial envelope evaluation from completed-sales count and install epoch ms. */
export function evaluateTrial(status: LicenseStatus, salesCount: number, installEpochMs: number, nowMs: number): TrialState {
  if (status === 'ACTIVATED') {
    return { status, salesUsed: salesCount, salesRemaining: Number.POSITIVE_INFINITY, daysUsed: 0, daysRemaining: Number.POSITIVE_INFINITY };
  }
  const daysUsed = Math.max(0, Math.floor((nowMs - installEpochMs) / 86400000));
  return {
    status: 'TRIAL',
    salesUsed: salesCount,
    salesRemaining: Math.max(0, TRIAL_MAX_SALES - salesCount),
    daysUsed,
    daysRemaining: Math.max(0, TRIAL_MAX_DAYS - daysUsed),
  };
}
