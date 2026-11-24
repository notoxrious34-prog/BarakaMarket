/**
 * Baraka Market — BarakaLock v2 envelope (ADR-050).
 * `AK2-<b64url(json)>.<b64url(sig)>`: versioned, tiered, expiring-capable,
 * spare-HWID license envelope signed with the SAME Ed25519 owner key.
 * v1 keys (`AK-…`) keep verifying — backward compatible, no shop breaks.
 * Pure + string-based; WebCrypto-verify only (no private key anywhere here).
 *
 * @module core/license-envelope
 */
import { canonicalStoreName, verifyEd25519Signature, BARAKA_PUBLIC_KEY } from './licensing';

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_PUBKEY_ID = 'prod1';
export type LicenseTier = 'PERP' | 'SUPPORT12';

const HWID_RE = /^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
const AK2_RE = /^AK2-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

export interface LicenseEnvelope {
  v: 1;
  pub: string;
  tier: LicenseTier;
  issued: number;
  exp: number | null;
  maxVer: string | null;
  h1: string;
  h2: string | null;
  feat: number;
  store: string;
}

export interface EnvelopeInput {
  tier: LicenseTier;
  issuedMs: number;
  expiresMs?: number | null;
  maxVer?: string | null;
  hwid1: string;
  hwid2?: string | null;
  features?: number;
}

/** Canonical signed bytes: every policy field + canonical store name. */
export function buildEnvelopePayload(e: LicenseEnvelope): Uint8Array {
  const s = [
    'BM-V2', String(e.v), e.pub, e.tier, String(e.issued),
    e.exp === null ? '' : String(e.exp), e.maxVer ?? '',
    e.h1, e.h2 ?? '', String(e.feat), canonicalStoreName(e.store), '',
  ].join('|');
  return new TextEncoder().encode(s);
}

export function envelopeFromInput(storeName: string, input: EnvelopeInput): LicenseEnvelope | null {
  const h1 = input.hwid1.trim().toUpperCase();
  const h2 = input.hwid2?.trim()?.toUpperCase() || null;
  if (!HWID_RE.test(h1)) return null;
  if (h2 !== null && !HWID_RE.test(h2)) return null;
  if (input.tier !== 'PERP' && input.tier !== 'SUPPORT12') return null;
  if (!Number.isInteger(input.issuedMs) || input.issuedMs <= 0) return null;
  const exp = input.expiresMs ?? null;
  if (exp !== null && (!Number.isInteger(exp) || exp <= input.issuedMs)) return null;
  return {
    v: 1, pub: ENVELOPE_PUBKEY_ID, tier: input.tier, issued: input.issuedMs,
    exp, maxVer: input.maxVer ?? null, h1, h2, feat: input.features ?? 0,
    store: storeName.trim(),
  };
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : '';
    const bin = atob(b64 + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Mint the transport key from envelope JSON + raw signature (staff/desk side). */
export function formatEnvelopeKey(env: LicenseEnvelope, sigB64url: string): string {
  const json = new TextEncoder().encode(JSON.stringify(env));
  return `AK2-${b64urlEncode(json)}.${sigB64url}`;
}

export interface ParsedEnvelope {
  env: LicenseEnvelope;
  sigB64url: string;
}

function isEnvelope(o: unknown): o is LicenseEnvelope {
  if (typeof o !== 'object' || o === null) return false;
  const e = o as Record<string, unknown>;
  return e.v === 1 && typeof e.pub === 'string'
    && (e.tier === 'PERP' || e.tier === 'SUPPORT12')
    && Number.isInteger(e.issued) && (e.exp === null || Number.isInteger(e.exp))
    && (e.maxVer === null || typeof e.maxVer === 'string')
    && typeof e.h1 === 'string' && HWID_RE.test(e.h1)
    && (e.h2 === null || (typeof e.h2 === 'string' && HWID_RE.test(e.h2)))
    && Number.isInteger(e.feat) && typeof e.store === 'string' && (e.store as string).trim().length > 0;
}

/** Structural parse only — no crypto. Null on any malformation. */
export function parseEnvelopeKey(key: string): ParsedEnvelope | null {
  const m = AK2_RE.exec(key.trim());
  if (!m) return null;
  const raw = b64urlDecode(m[1]);
  if (!raw || raw.length > 2048) return null;
  try {
    const env = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    if (!isEnvelope(env)) return null;
    if (!/^[A-Za-z0-9_-]{86}$/.test(m[2])) return null;
    return { env, sigB64url: m[2] };
  } catch {
    return null;
  }
}

export interface EnvelopeVerdict {
  ok: boolean;
  slot?: 1 | 2;
  tier?: LicenseTier;
  expired?: boolean;
  maxVer?: string | null;
}

/**
 * Full v2 validation: structure → store → slot → expiry → signature.
 * Fails closed on everything; expiry is reported (grace lives above).
 */
export async function validateEnvelopeKey(
  storeName: string, hwid: string, key: string, nowMs: number,
  pubkeyHex: string = BARAKA_PUBLIC_KEY,
): Promise<EnvelopeVerdict> {
  const p = parseEnvelopeKey(key);
  if (!p) return { ok: false };
  if (canonicalStoreName(p.env.store) !== canonicalStoreName(storeName)) return { ok: false };
  const hw = hwid.trim().toUpperCase();
  const slot = hw === p.env.h1 ? 1 : hw === p.env.h2 ? 2 : 0;
  if (slot === 0) return { ok: false };
  if (p.env.exp !== null && nowMs > p.env.exp) {
    return { ok: false, slot: slot as 1 | 2, tier: p.env.tier, expired: true };
  }
  const sigOk = await verifyEd25519Signature(pubkeyHex, buildEnvelopePayload(p.env), p.sigB64url);
  if (!sigOk) return { ok: false };
  return { ok: true, slot: slot as 1 | 2, tier: p.env.tier, maxVer: p.env.maxVer };
}
