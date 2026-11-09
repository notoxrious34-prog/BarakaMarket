/**
 * Baraka Market — RBAC core (T8, ADR-031). Pure, dependency-free.
 * Roles are hierarchical: owner ⊇ manager ⊇ cashier. Every permission
 * check funnels through `can(role, perm)` so the matrix has exactly one
 * home. Sessions expire on inactivity; PIN failures lock out with backoff.
 *
 * PIN hashing (salted SHA-256) lives in the DAL lanes (TS: node:crypto,
 * Rust: pinned implementation + NIST vectors) — this module only defines
 * the lockout policy and session shape both lanes share.
 *
 * @module core/rbac
 */

export type Role = 'cashier' | 'manager' | 'owner';

export type Permission =
  | 'sell' | 'settle' | 'print' | 'sale.void'
  | 'products.edit' | 'clients.edit' | 'cash.manage'
  | 'z.close' | 'accounting.view'
  | 'expense.record' | 'worker.manage' | 'payroll.settle'
  | 'settings.edit' | 'users.manage' | 'audit.view'
  | 'returns.create' | 'returns.approve'
  | 'claims.create' | 'claims.settle';

const RANK: Record<Role, number> = { cashier: 0, manager: 1, owner: 2 };

/** Minimum rank per permission — one table, no scattered ifs. */
const MIN_RANK: Record<Permission, number> = {
  sell: 0, settle: 0, print: 0, 'sale.void': 1,
  'products.edit': 1, 'clients.edit': 1, 'cash.manage': 1,
  'z.close': 1, 'accounting.view': 1,
  'expense.record': 0, 'worker.manage': 1, 'payroll.settle': 1,
  'settings.edit': 2, 'users.manage': 2, 'audit.view': 1,
  // v1.5.0 (RETURNS): every cashier drafts, manager+ decides (two-person
  // rule above 5000 DZD enforced lane-side, never in the view).
  'returns.create': 0, 'returns.approve': 1,
  // R-bridge: every cashier flags the supplier issue, manager+ closes it.
  'claims.create': 0, 'claims.settle': 1,
};

export function can(role: Role, perm: Permission): boolean {
  return RANK[role] >= (MIN_RANK[perm] ?? 99);
}

export function isRole(s: string): s is Role {
  return s === 'cashier' || s === 'manager' || s === 'owner';
}

/** Failed-PIN lockout: 5 strikes => locked, backoff doubles per cycle. */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_BASE_LOCK_MS = 60_000;

export interface LockState {
  failedAttempts: number;
  lockedUntil: number | null;
  lockCycles: number;
}

export function emptyLock(): LockState {
  return { failedAttempts: 0, lockedUntil: null, lockCycles: 0 };
}

export function isLocked(s: LockState, now = Date.now()): boolean {
  return s.lockedUntil !== null && now < s.lockedUntil;
}

/** Fold one attempt into the lock state. Returns whether login may proceed. */
export function registerAttempt(s: LockState, ok: boolean, now = Date.now()): LockState {
  if (ok) return { failedAttempts: 0, lockedUntil: null, lockCycles: s.lockCycles };
  const failed = s.failedAttempts + 1;
  if (failed < PIN_MAX_ATTEMPTS) return { ...s, failedAttempts: failed };
  const cycles = s.lockCycles + 1;
  const backoff = PIN_BASE_LOCK_MS * 2 ** (cycles - 1);
  return { failedAttempts: 0, lockedUntil: now + backoff, lockCycles: cycles };
}

/** Session: the cashier identity every fiscal row stamps. */
export interface Session {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  loginAt: number;
  lastActivityAt: number;
}

/** Inactivity lock (default 15 min) — the shop floor walks away a lot. */
export const SESSION_IDLE_MS = 15 * 60_000;

export function isSessionLive(s: Session, now = Date.now(), idleMs = SESSION_IDLE_MS): boolean {
  return now - s.lastActivityAt < idleMs;
}

/** Security audit actions (T8). Transactional audit is T10. */
export type AuditAction =
  | 'login.ok' | 'login.fail' | 'login.locked' | 'logout' | 'session.lock' | 'session.unlock'
  | 'user.create' | 'user.deactivate' | 'pin.change' | 'pin.reset' | 'users.rotation_config' | 'owner.confirm'
  | 'update.check' | 'update.install'
  | 'sale.commit' | 'settlement.commit' | 'sale.void' | 'sale.duplicata' | 'z.close'
  | 'return.create' | 'return.approve' | 'return.reject'
  | 'claim.create' | 'claim.settle'
  | 'expense.add' | 'advance.add' | 'salary.settle' | 'factory_reset'
  | 'supplier.pay' | 'profile.change' | 'stock.import' | 'stock.export' | 'backup.create' | 'backup.restore';

export interface AuditEvent {
  actor: string;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  detail?: string;
  at?: string;
}
