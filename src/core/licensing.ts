/**
 * Baraka Market — BarakaLock air-gapped licensing (ADR-002-MKT).
 * Asymmetric Ed25519: the owner signs (keygen CLI, private key NEVER ships);
 * the client only VERIFIES against the embedded public key. No symmetric
 * secret exists anywhere in the shipped bundle. All string-based, no floats.
 *
 * @module core/licensing
 */
import { sha256Hex } from './sha256';

/**
 * Ed25519 public key (raw 32 bytes, hex) matching the owner's offline
 * private key. VERIFY-ONLY — safe to ship; it cannot mint keys.
 */
export const BARAKA_PUBLIC_KEY = 'f3d6687ed8b7ee5289b9deff4a9c37f4aa7526dc383b6c40384cd1ce160a2811';

/** Retail price anchor (DZD) — informational, enforced by sales policy. */
export const LICENSE_PRICE_DZD = 5000;

/** Trial envelope: 50 sales AND 14 days — expiry needs BOTH exhausted. */
export const TRIAL_MAX_SALES = 50;
export const TRIAL_MAX_DAYS = 14;

export type LicenseStatus = 'TRIAL' | 'ACTIVATED';

/** Canonical store identity: trim + uppercase (AR script unaffected). */
export function canonicalStoreName(storeName: string): string {
  return storeName.trim().toUpperCase();
}

/** Canonical signed payload bytes: `STORE||HWID`. */
export function buildLicensePayload(storeName: string, hwid: string): Uint8Array {
  return new TextEncoder().encode(`${canonicalStoreName(storeName)}||${hwid.trim().toUpperCase()}`);
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error('bad hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface MachineParts {
  arch: string;
  hostname: string;
  osVersion: string;
  seed: string;
}

const GROUP = (hex16: string, prefix: string): string =>
  `${prefix}-${hex16.slice(0, 4)}-${hex16.slice(4, 8)}-${hex16.slice(8, 12)}-${hex16.slice(12, 16)}`.toUpperCase();

/**
 * Deterministic machine fingerprint → BM-XXXX-XXXX-XXXX-XXXX.
 * ADR-002: derived STRICTLY from arch + osVersion + hostname + seed.
 * Screen resolution is EXCLUDED — monitor swaps must not void the license.
 */
export function computeHwid(parts: MachineParts): string {
  const digest = sha256Hex(
    [parts.arch, parts.hostname, parts.osVersion, parts.seed].join('|'),
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
    seed,
  };
}

/** Node-lane fingerprint (loopback/CLI): os+hostname backed. */
export function collectNodeFingerprint(seed: string, os: { arch(): string; hostname(): string; release(): string }): MachineParts {
  return {
    arch: os.arch(),
    hostname: os.hostname(),
    osVersion: os.release(),
    seed,
  };
}

/** Activation key: `AK-` + base64url(Ed25519(store||hwid)) — 86 chars, no padding. */
export function formatActivationKey(sigB64url: string): string {
  return `AK-${sigB64url}`;
}

const AK_RE = /^AK-([A-Za-z0-9_-]{86})$/;

/**
 * Verify an Ed25519 signature against any raw-32-byte hex public key.
 * Fails closed (false) on malformed input or runtimes without Ed25519.
 */
export async function verifyEd25519Signature(pubkeyHex: string, message: Uint8Array, sigB64url: string): Promise<boolean> {
  try {
    const pub = new Uint8Array(hexToBytes(pubkeyHex)) as Uint8Array<ArrayBuffer>;
    if (pub.length !== 32) return false;
    const sig = new Uint8Array(b64urlToBytes(sigB64url)) as Uint8Array<ArrayBuffer>;
    if (sig.length !== 64) return false;
    const msg = new Uint8Array(message) as Uint8Array<ArrayBuffer>;
    const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, sig, msg);
  } catch {
    return false;
  }
}

/** Offline validation — pure async verify against the embedded public key. */
export async function validateLicense(storeName: string, hwid: string, key: string): Promise<boolean> {
  const m = AK_RE.exec(key.trim());
  if (!m || !storeName.trim() || !hwid.trim()) return false;
  return verifyEd25519Signature(BARAKA_PUBLIC_KEY, buildLicensePayload(storeName, hwid), m[1]);
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
