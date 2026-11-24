/**
 * Baraka Market — lane license policy (ADR-050 P2).
 * Pure and SYNC: both lanes (Node + Rust) evaluate the same rule without
 * crypto. Signature genuineness is verified by crypto-capable callers
 * (TS boot/route, client) and PUBLISHED via `license_gate`; the lanes
 * enforce the published verdict + trial budgets + override.
 * Absent data = ALLOW (no-brick grandfathering).
 *
 * @module core/license-gate
 */
import { evaluateTrial } from './licensing';
import { parseEnvelopeKey } from './license-envelope';

export const TRIAL_EPOCH_META_KEY = 'trial_epoch';
export const LICENSE_GATE_META_KEY = 'license_gate';
export const LICENSE_OVERRIDE_META_KEY = 'license_override_until';

export type GateRefusal =
  | 'LICENSE_TRIAL_EXPIRED'
  | 'LICENSE_KEY_INVALID'
  | 'LICENSE_SUBSCRIPTION_EXPIRED'
  | 'LICENSE_DENIED';

export interface LaneGateState {
  /** Parsed license_state record, null when absent or malformed. */
  activated: boolean;
  /** v1/v2 signature over (store || activation hwid). Null = not verified here (Rust lane: see publishedGateDenied). */
  keyGenuine: boolean | null;
  /** v2 SUPPORT12 past exp (pure date read, no crypto). */
  subscriptionExpired: boolean;
  /** Client-published verdict: true = denied (plain), string = denied with that reason. */
  publishedGateDenied: boolean | GateRefusal;
  /** Owner 24h override still valid. */
  overrideValid: boolean;
  /** Trial budgets (from meta epoch + fiscal sales count). */
  trialAlive: boolean;
}

export function laneVerdict(s: LaneGateState): { ok: true } | { ok: false; reason: GateRefusal } {
  if (s.overrideValid) return { ok: true };
  if (s.publishedGateDenied) {
    return {
      ok: false,
      reason: typeof s.publishedGateDenied === 'string' ? s.publishedGateDenied : 'LICENSE_DENIED',
    };
  }
  if (s.activated) {
    if (s.keyGenuine === false) return { ok: false, reason: 'LICENSE_KEY_INVALID' };
    if (s.subscriptionExpired) return { ok: false, reason: 'LICENSE_SUBSCRIPTION_EXPIRED' };
    return { ok: true };
  }
  if (!s.trialAlive) return { ok: false, reason: 'LICENSE_TRIAL_EXPIRED' };
  return { ok: true };
}

/** Trial budgets from the anchored epoch (pure; both lanes share it). */
export function trialAliveFor(salesCount: number, trialEpochMs: number, nowMs: number): boolean {
  const t = evaluateTrial('TRIAL', salesCount, trialEpochMs, nowMs);
  return t.salesRemaining > 0 || t.daysRemaining > 0;
}

/** v2 expiry as a pure date read (the signature itself is verified upstream). */
export function subscriptionExpiredFor(key: string, nowMs: number): boolean {
  if (!key.startsWith('AK2-')) return false;
  const p = parseEnvelopeKey(key);
  const exp = p?.env.exp ?? null;
  return exp !== null && nowMs > exp;
}
