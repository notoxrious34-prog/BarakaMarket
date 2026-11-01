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

/** Owner-gated creation (the server re-checks requesterRole — never trust the UI). */
export async function createSessionUser(
  input: { username: string; display_name?: string; role: Role; pin: string },
  requesterRole: Role,
  actor: string,
): Promise<SessionUser | null> {
  if (isTauriRuntime()) return null; // T8b: native user management
  const r = await postLoopback<SessionUser>('/api/users', { ...input, requesterRole, actor });
  return r && typeof r.id === 'number' ? r : null;
}

/** Owner-gated activate/deactivate (loopback lane; T8b brings the native lane). */
export async function setSessionUserActive(
  id: number, active: boolean, requesterRole: Role, actor: string,
): Promise<boolean> {
  if (isTauriRuntime()) return false; // T8b: native user management
  return (await postLoopback<{ ok?: boolean }>('/api/users/active', { id, active, requesterRole, actor }))?.ok === true;
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
