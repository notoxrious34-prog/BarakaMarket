import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, isRole, registerAttempt, emptyLock, isLocked,
  isSessionLive, PIN_MAX_ATTEMPTS, type Session,
} from './rbac.js';

/** T8 (ADR-031): one permission table, lockout math, session life. */
describe('rbac core (T8)', () => {
  it('hierarchy owner > manager > cashier on every permission', () => {
    const perms = ['sell', 'settle', 'print', 'products.edit', 'clients.edit',
      'cash.manage', 'z.close', 'accounting.view', 'settings.edit', 'users.manage', 'audit.view'] as const;
    for (const p of perms) {
      assert.equal(can('cashier', p) || can('manager', p) || can('owner', p), true);
      if (can('cashier', p)) assert.equal(can('manager', p), true);
      if (can('manager', p)) assert.equal(can('owner', p), true);
    }
  });

  it('cashier sells and settles but never touches settings/users', () => {
    assert.equal(can('cashier', 'sell'), true);
    assert.equal(can('cashier', 'settle'), true);
    assert.equal(can('cashier', 'settings.edit'), false);
    assert.equal(can('cashier', 'users.manage'), false);
    assert.equal(can('manager', 'users.manage'), false);
    assert.equal(can('owner', 'users.manage'), true);
  });

  it('five strikes lock, success resets, backoff doubles', () => {
    let s = emptyLock();
    for (let i = 0; i < PIN_MAX_ATTEMPTS - 1; i++) {
      s = registerAttempt(s, false);
      assert.equal(isLocked(s), false);
    }
    s = registerAttempt(s, false, 1_000);
    assert.equal(isLocked(s, 2_000), true);
    assert.equal(isLocked(s, 61_001), false);
    assert.equal(s.lockCycles, 1);
    s = registerAttempt(s, true);
    assert.equal(isLocked(s), false);
    assert.equal(s.failedAttempts, 0);
  });

  it('idle sessions die at 15 minutes', () => {
    const s: Session = {
      userId: 1, username: 'amine', displayName: 'Amine', role: 'cashier',
      loginAt: 0, lastActivityAt: 0,
    };
    assert.equal(isSessionLive(s, 14 * 60_000), true);
    assert.equal(isSessionLive(s, 16 * 60_000), false);
  });

  it('isRole narrows safely', () => {
    assert.equal(isRole('owner'), true);
    assert.equal(isRole('root'), false);
  });
});
