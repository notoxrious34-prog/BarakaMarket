/**
 * Baraka Market — offline unlock codes (ADR-050 P3).
 * `UL-<b64url(json)>.<b64url(sig)>`: Ed25519 over (hwid||counter||exp||scope)
 * with the SAME owner key. Single-use via `meta.unlock_counter` (the client
 * consumes a code by raising `license_override_until` to min(exp, now+7d)).
 * Scopes: tamper (clock-rollback lock), drift (false HWID lock), emergency.
 *
 * @module core/license-unlock
 */
import { verifyEd25519Signature, BARAKA_PUBLIC_KEY } from './licensing';

export type UnlockScope = 'tamper' | 'drift' | 'emergency';
const UL_RE = /^UL-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{86})$/;
const HWID_RE = /^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

export interface UnlockToken {
  hwid: string;
  counter: number;
  exp: number;
  scope: UnlockScope;
}

/** Canonical signed bytes. */
export function buildUnlockPayload(t: UnlockToken): Uint8Array {
  return new TextEncoder().encode(`BM-UL|${t.hwid}|${t.counter}|${t.exp}|${t.scope}|`);
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

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mint the transport code from token JSON (staff/desk side, signs outside). */
export function formatUnlockToken(t: UnlockToken, sigB64url: string): string {
  const json = new TextEncoder().encode(JSON.stringify(t));
  return `UL-${b64urlEncode(json)}.${sigB64url}`;
}

function isToken(o: unknown): o is UnlockToken {
  if (typeof o !== 'object' || o === null) return false;
  const t = o as Record<string, unknown>;
  return typeof t.hwid === 'string' && HWID_RE.test(t.hwid)
    && Number.isInteger(t.counter) && (t.counter as number) > 0
    && Number.isInteger(t.exp)
    && (t.scope === 'tamper' || t.scope === 'drift' || t.scope === 'emergency');
}

export interface UnlockVerdict {
  ok: boolean;
  token?: UnlockToken;
  reason?: 'MALFORMED' | 'WRONG_MACHINE' | 'REPLAY' | 'EXPIRED' | 'BAD_SIGNATURE';
}

/**
 * Full validation: shape → machine → freshness (counter > last) → expiry →
 * signature. Fails closed; replay of a consumed counter is refused.
 */
export async function verifyUnlock(
  token: string, currentHwid: string, lastCounter: number, nowMs: number,
  pubkeyHex: string = BARAKA_PUBLIC_KEY,
): Promise<UnlockVerdict> {
  const m = UL_RE.exec(token.trim());
  if (!m) return { ok: false, reason: 'MALFORMED' };
  const raw = b64urlDecode(m[1]);
  if (!raw || raw.length > 512) return { ok: false, reason: 'MALFORMED' };
  let t: unknown;
  try {
    t = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!isToken(t)) return { ok: false, reason: 'MALFORMED' };
  if (t.hwid !== currentHwid.trim().toUpperCase()) return { ok: false, reason: 'WRONG_MACHINE' };
  if (t.counter <= lastCounter) return { ok: false, reason: 'REPLAY' };
  if (nowMs > t.exp) return { ok: false, reason: 'EXPIRED' };
  const sigOk = await verifyEd25519Signature(pubkeyHex, buildUnlockPayload(t), m[2]);
  if (!sigOk) return { ok: false, reason: 'BAD_SIGNATURE' };
  return { ok: true, token: t };
}
