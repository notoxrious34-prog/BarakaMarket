/**
 * Baraka Market — Session authority bridge (T8, ADR-031).
 * Invoke-first, loopback fallback, null last — the same lane order as the
 * fiscal commit path. verify/list/change/audit are all covered on both
 * lanes; user CREATION stays owner-gated server-side (requesterRole).
 *
 * @module core/session-authority
 */
import { isTauriRuntime, LOOPBACK_BASE, getLoopbackToken } from './fiscal-authority.js';
import type { Role, AuditAction } from './rbac.js';

export interface SessionUser {
  id: number; username: string; display_name: string; role: Role;
  must_change_pin: number; active: number;
  /** v1.5.1 §1 */
  freeze_reason?: string | null; freeze_note?: string | null;
  /** v1.5.1 §3 */
  pin_expires_at?: string | null;
  /** v1.5.1 §4: rotation clock (from user_list). NULL = fresh. */
  pin_changed_at?: string | null;
  /** v1.5.1 §4: computed at verify only. */
  rotation_due?: boolean; rotation_days_left?: number;
}

export type VerifyOut = { ok: true; user: SessionUser } | { ok: false; locked: boolean };

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    return ((await mod.invoke(command, args)) as T) ?? null;
  } catch {
    return null;
  }
}

async function postLoopback<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const token = await getLoopbackToken();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${LOOPBACK_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok && r.status !== 401 && r.status !== 403) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function isVerifyOut(v: unknown): v is VerifyOut {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.ok === true) {
    const u = o.user as Record<string, unknown> | undefined;
    return !!u && typeof u.id === 'number' && typeof u.username === 'string' && typeof u.role === 'string';
  }
  return o.ok === false;
}

/** Verify a PIN on the native lane, else the loopback. Never throws. */
export async function loginUser(username: string, pin: string): Promise<VerifyOut> {
  const native = await invokeNative<VerifyOut>('user_verify', { username, pin });
  if (isVerifyOut(native)) return native;
  if (isTauriRuntime()) return { ok: false, locked: false };
  const loop = await postLoopback<VerifyOut>('/api/users/verify', { username, pin });
  return isVerifyOut(loop) ? loop : { ok: false, locked: false };
}

/** Safe user list (null outside both lanes). */
export async function listSessionUsers(): Promise<SessionUser[] | null> {
  const native = await invokeNative<SessionUser[]>('user_list');
  if (Array.isArray(native)) return native;
  if (isTauriRuntime()) return null;
  try {
    const r = await fetch(`${LOOPBACK_BASE}/api/users`);
    if (!r.ok) return null;
    const j = (await r.json()) as unknown;
    return Array.isArray(j) ? (j as SessionUser[]) : null;
  } catch {
    return null;
  }
}

/** Change own PIN (old PIN required). False when neither lane answers. */
export async function changeSessionPin(userId: number, oldPin: string, newPin: string): Promise<boolean> {
  // T12: the native lane owns PIN change (the exe has no loopback server).
  const native = await invokeNative<{ ok?: boolean }>('change_pin', { userId, oldPin, newPin });
  if (native && native.ok) return true;
  if (isTauriRuntime()) return false;
  return (await postLoopback<{ ok?: boolean }>('/api/users/pin', { userId, oldPin, newPin }))?.ok === true;
}

/** Client-side security event (logout, session lock/unlock). Fire-and-forget. */
export async function auditSessionEvent(actor: string, action: AuditAction, detail = ''): Promise<void> {
  try {
    if (isTauriRuntime()) {
      await invokeNative('audit_log', { actor, action, detail });
      return;
    }
    await postLoopback('/api/audit', { actor, action, detail });
  } catch { /* audit never breaks the flow */ }
}

/** Last refusal reason of the user-management lane (validation, taken,
 *  owner-gate, offline). Read it right after a null/false return — the lane
 *  never throws, mirroring the fiscal `lastLaneError` pattern. */
let userLaneError: string | null = null;
export function lastUserLaneError(): string | null {
  return userLaneError;
}

type LaneOut<T> = { ok: true; value: T } | { ok: false; error: string };

async function invokeUserNative<T>(command: string, args: Record<string, unknown>): Promise<LaneOut<T>> {
  if (!isTauriRuntime()) return { ok: false, error: '' };
  try {
    const mod = await import('@tauri-apps/api/core');
    return { ok: true, value: (await mod.invoke(command, args)) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function postUserLoopback<T>(path: string, body: unknown): Promise<LaneOut<T>> {
  try {
    const token = await getLoopbackToken();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${LOOPBACK_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      let detail = '';
      try {
        detail = (await r.json() as { error?: string }).error ?? '';
      } catch {
        /* text body — status is the signal */
      }
      return { ok: false, error: detail || `HTTP ${r.status}` };
    }
    return { ok: true, value: (await r.json()) as T };
  } catch {
    return { ok: false, error: 'lane unreachable' };
  }
}

function isSessionUser(v: unknown): v is SessionUser {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'number' && typeof o.username === 'string' && typeof o.role === 'string';
}

/** Owner-gated creation (invoke-first, loopback fallback). Null on any
 *  refusal — read `lastUserLaneError()` for the reason (taken, validation,
 *  owner-gate, offline). Never throws.
 *  v1.5.1 B2-5: `opts.ownerConfirmPin` (the requesting owner's own current
 *  PIN) is REQUIRED when `input.role === 'owner'` — presence proof + double
 *  audit; lanes re-check. */
export async function createSessionUser(
  input: { username: string; display_name?: string; role: Role; pin: string },
  requesterRole: Role,
  actor: string,
  opts?: { ownerConfirmPin?: string },
): Promise<SessionUser | null> {
  userLaneError = null;
  if (isTauriRuntime()) {
    // The exe owns SQLite directly — no loopback server runs beside it, so a
    // native refusal is final (no 4 s fallback stall).
    const n = await invokeUserNative<SessionUser>('user_create', {
      username: input.username,
      displayName: input.display_name ?? '',
      role: input.role,
      pin: input.pin,
      requesterRole,
      actor,
      confirmPin: opts?.ownerConfirmPin ?? '',
    });
    if (n.ok && isSessionUser(n.value)) return n.value;
    userLaneError = (n.ok ? '' : n.error) || 'native lane refused';
    return null;
  }
  const l = await postUserLoopback<SessionUser>('/api/users', { ...input, requesterRole, actor, confirmPin: opts?.ownerConfirmPin });
  if (l.ok && isSessionUser(l.value)) return l.value;
  userLaneError = (l.ok ? '' : l.error) || 'server refused';
  return null;
}

/**
 * v1.5.1 §4: rotation window read — native first, token-lane fallback.
 * Default 90 (both lanes agree), so offline reads stay coherent.
 */
export async function getRotationDays(): Promise<number> {
  const pick = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    const d = (v as { days?: unknown } | null)?.days;
    return typeof d === 'number' && Number.isInteger(d) ? d : null;
  };
  if (isTauriRuntime()) {
    const n = await invokeUserNative<unknown>('rotation_get', {});
    const d = n.ok ? pick(n.value) : null;
    if (d !== null) return d;
  }
  const l = await getUserLoopback<unknown>('/api/users/rotation');
  return (l.ok ? pick(l.value) : null) ?? 90;
}

/**
 * v1.5.1 §4: rotation window write (owner only, both lanes).
 * Throws a human error on refusal/invalid.
 */
export async function setRotationDays(days: number, actor: string): Promise<void> {
  const payload = { days, requesterRole: 'owner', actor };
  const fail = (e: string) => { throw new Error(mapRotationError(e)); };
  if (isTauriRuntime()) {
    const n = await invokeUserNative<{ ok?: boolean }>('rotation_set', payload);
    if (!(n.ok && (n.value as { ok?: boolean }).ok)) fail(n.ok ? '' : n.error);
    return;
  }
  const l = await postUserLoopback<{ ok?: boolean }>('/api/users/rotation', payload);
  if (!(l.ok && l.value.ok)) fail(l.ok ? '' : l.error);
}

/** v1.5.1 §4: lane-agnostic validation copy (the lanes re-check anyway). */
function mapRotationError(e: string): string {
  if (/1-365|1–365|days/.test(e)) return 'النافذة بين يوم و365 يوماً';
  if (/owner/i.test(e)) return 'المالك فقط يغيّر نافذة التدوير';
  return 'تعذر حفظ نافذة التدوير';
}

async function getUserLoopback<T>(path: string): Promise<LaneOut<T>> {
  try {
    const token = await getLoopbackToken();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${LOOPBACK_BASE}${path}`, {
      headers: { ...(token ? { 'x-baraka-loopback': token } : {}) },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, value: (await r.json()) as T };
  } catch {
    return { ok: false, error: 'lane unreachable' };
  }
}

/** Owner-gated activate/deactivate (invoke-first, loopback fallback). False
 *  on any refusal — read `lastUserLaneError()` for the reason. Never throws.
 *  v1.5.1 §1: deactivation REQUIRES `{reason, note?}` (lane re-checks). */
export async function setSessionUserActive(
  id: number, active: boolean, requesterRole: Role, actor: string,
  opts?: { reason?: string; note?: string | null },
): Promise<boolean> {
  userLaneError = null;
  if (isTauriRuntime()) {
    const n = await invokeUserNative<{ ok?: boolean }>('user_set_active', {
      userId: id, active, requesterRole, actor,
      reason: opts?.reason ?? '', note: opts?.note ?? '',
    });
    if (n.ok && n.value && n.value.ok === true) return true;
    userLaneError = (n.ok ? '' : n.error) || 'native lane refused';
    return false;
  }
  const l = await postUserLoopback<{ ok?: boolean }>('/api/users/active', {
    id, active, requesterRole, actor, reason: opts?.reason, note: opts?.note ?? null,
  });
  if (l.ok && l.value && l.value.ok === true) return true;
  userLaneError = (l.ok ? '' : l.error) || 'server refused';
  return false;
}

/** v1.5.1 §3: owner-issued temporary PIN (invoke-first, loopback fallback).
 *  False on any refusal — read `lastUserLaneError()` for the reason
 *  (owner-gate, owner immunity, PIN shape, offline). The lane flags
 *  must_change_pin=1: the PIN dies at first login. `opts.expiresAt`
 *  (`YYYY-MM-DDTHH:MM:SS`, UTC, future) arms auto-expiry. Never throws. */
export async function resetSessionUserPin(
  id: number, pin: string, requesterRole: Role, actor: string,
  opts?: { expiresAt?: string | null },
): Promise<boolean> {
  userLaneError = null;
  if (isTauriRuntime()) {
    const n = await invokeUserNative<{ ok?: boolean }>('reset_pin', {
      userId: id, newPin: pin, requesterRole, actor,
      expiresAt: opts?.expiresAt ?? '',
    });
    if (n.ok && n.value && n.value.ok === true) return true;
    userLaneError = (n.ok ? '' : n.error) || 'native lane refused';
    return false;
  }
  const l = await postUserLoopback<{ ok?: boolean }>('/api/users/reset-pin', {
    userId: id, newPin: pin, requesterRole, actor,
    expiresAt: opts?.expiresAt ?? null,
  });
  if (l.ok && l.value && l.value.ok === true) return true;
  userLaneError = (l.ok ? '' : l.error) || 'server refused';
  return false;
}

export interface AuditListRow {
  id: number; ts: string; actor: string; action: string;
  entity: string; entity_id: string; detail: string;
}

/** Last security events (invoke-first, loopback fallback). */
export async function listAuditEvents(limit = 100): Promise<AuditListRow[] | null> {
  const native = await invokeNative<AuditListRow[]>('audit_list', { limit });
  if (Array.isArray(native)) return native;
  if (isTauriRuntime()) return null;
  try {
    const r = await fetch(`${LOOPBACK_BASE}/api/audit?limit=${Math.max(1, Math.min(500, limit))}`);
    if (!r.ok) return null;
    const j = (await r.json()) as unknown;
    return Array.isArray(j) ? (j as AuditListRow[]) : null;
  } catch {
    return null;
  }
}
