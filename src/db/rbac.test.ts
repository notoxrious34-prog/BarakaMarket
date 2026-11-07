import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb, LATEST_SCHEMA_VERSION } from './sqlite.js';

// T8 (ADR-031): users + lockout + audit live in the DAL.
// NOTE: C: is 100% full -> test DBs live under repo data/.tmp-tests (D:).
const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
let n = 0;
const tmpFile = (tag: string) => {
  n += 1;
  const p = path.join(TMP, `${tag}-${process.pid}-${n}.db`);
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* fresh */ }
  }
  return p;
};
const cleanup = (p: string) => {
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
};

test('T8/T11: fresh DB seeds the owner at latest schema (v11)', () => {
  const p = tmpFile('rbac');
  try {
    const b = openBarakaDb(p);
    assert.equal(LATEST_SCHEMA_VERSION, 11);
    const users = b.listUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0].username, 'owner');
    assert.equal(users[0].role, 'owner');
    assert.equal(users[0].must_change_pin, 1);
    assert.ok(!('pin_verifier' in users[0]), 'secrets never cross the DAL');
    b.close();
  } finally {
    cleanup(p);
  }
});

test('T8: verify ok, five strikes lock, expiry unlocks', () => {
  const p = tmpFile('rbac');
  try {
    const b = openBarakaDb(p);
    const ok = b.verifyUser('owner', '1234');
    assert.equal(ok.ok, true);
    for (let i = 0; i < 4; i++) {
      const r = b.verifyUser('owner', '0000');
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.locked, false);
    }
    const fifth = b.verifyUser('owner', '0000');
    assert.equal(fifth.ok, false);
    if (!fifth.ok) assert.equal(fifth.locked, true);
    // Still locked with the RIGHT pin.
    const during = b.verifyUser('owner', '1234');
    assert.equal(during.ok, false);
    // Simulate backoff expiry.
    b.db.prepare('UPDATE users SET locked_until_ms = 0 WHERE username = ?').run('owner');
    const after = b.verifyUser('owner', '1234');
    assert.equal(after.ok, true);
    b.close();
  } finally {
    cleanup(p);
  }
});

test('T8: create/list/deactivate/changePin with audit trail', () => {
  const p = tmpFile('rbac');
  try {
    const b = openBarakaDb(p);
    const m = b.createUser({ username: 'Sara', display_name: 'Sara', role: 'manager', pin: '5678' }, 'owner');
    assert.equal(m.username, 'sara');
    assert.equal(m.role, 'manager');
    assert.throws(() => b.createUser({ username: 'sara', role: 'cashier', pin: '1111' }, 'owner'), /taken/);
    assert.throws(() => b.createUser({ username: 'x', role: 'cashier', pin: '1111' }, 'owner'), /username/);
    assert.throws(() => b.createUser({ username: 'bob', role: 'super' as never, pin: '1111' }, 'owner'), /role/);
    assert.throws(() => b.createUser({ username: 'bob', role: 'cashier', pin: '12' }, 'owner'), /PIN/);
    const v = b.verifyUser('sara', '5678');
    assert.equal(v.ok, true);
    // v1.5.1 §1: freeze reason is mandatory — missing/unknown refused.
    assert.throws(() => b.setUserActive(m.id, false, 'owner'), /freeze reason/);
    assert.throws(() => b.setUserActive(m.id, false, 'owner', { reason: 'VACATION' }), /freeze reason/);
    b.setUserActive(m.id, false, 'owner', { reason: 'leave', note: 'sick leave, back soon' });
    const frozen = b.listUsers().find(u => u.id === m.id)!;
    assert.equal(frozen.active, 0);
    assert.equal(frozen.freeze_reason, 'LEAVE');
    assert.equal(frozen.freeze_note, 'sick leave, back soon');
    assert.equal(b.verifyUser('sara', '5678').ok, false);
    const auditTrail = b.listAudit(50);
    assert.ok(auditTrail.some(a => a.action === 'user.deactivate' && a.detail.includes('[LEAVE]')), 'audit carries the freeze reason');
    b.setUserActive(m.id, true, 'owner');
    const back = b.listUsers().find(u => u.id === m.id)!;
    assert.equal(back.active, 1);
    assert.equal(back.freeze_reason, null);
    assert.equal(back.freeze_note, null);
    assert.throws(() => b.setUserActive(1, false, 'owner', { reason: 'LEAVE' }), /owner/);
    b.changePin(m.id, '5678', '8765');
    assert.throws(() => b.changePin(m.id, '0000', '1111'), /wrong/);
    // v1.5.1 §3: temporary PIN — old dies, new verifies with forced-change,
    // owner immune, bad shape refused, audit carries no PIN digits.
    b.resetUserPin(m.id, '4242', 'owner');
    assert.equal(b.verifyUser('sara', '8765').ok, false);
    const tv = b.verifyUser('sara', '4242');
    assert.equal(tv.ok, true);
    if (tv.ok) assert.equal(tv.user.must_change_pin, 1);
    assert.equal(b.listUsers().find(u => u.id === m.id)!.must_change_pin, 1);
    b.changePin(m.id, '4242', '9999');
    assert.equal(b.listUsers().find(u => u.id === m.id)!.must_change_pin, 0);
    assert.throws(() => b.resetUserPin(1, '4242', 'owner'), /never reset/);
    assert.throws(() => b.resetUserPin(m.id, '12', 'owner'), /PIN/);
    const resetAudit = b.listAudit(50).filter(a => a.action === 'pin.reset');
    assert.equal(resetAudit.length, 1);
    assert.ok(!/\d{4}/.test(resetAudit[0].detail), 'no PIN digits in audit');
    // §3 completion: expiry — bad shape / past refused; future armed and
    // enforced at verify; self-change clears the deadline.
    assert.throws(() => b.resetUserPin(m.id, '5151', 'owner', { expiresAt: 'not-a-date' }), /expiresAt/);
    assert.throws(() => b.resetUserPin(m.id, '5151', 'owner', { expiresAt: '2000-01-01T00:00:00' }), /future/);
    b.resetUserPin(m.id, '5151', 'owner', { expiresAt: '2099-12-31T23:59:59' });
    assert.equal(b.listUsers().find(u => u.id === m.id)!.pin_expires_at, '2099-12-31T23:59:59');
    assert.equal(b.verifyUser('sara', '5151').ok, true);
    b.db.prepare("UPDATE users SET pin_expires_at = '2000-01-01T00:00:00' WHERE id = ?").run(m.id);
    assert.equal(b.verifyUser('sara', '5151').ok, false);
    const expAudit = b.listAudit(50);
    assert.ok(expAudit.some(a => a.action === 'login.fail' && a.detail === 'temp-expired'), 'audit marks temp-expired');
    b.resetUserPin(m.id, '5151', 'owner', { expiresAt: '2099-12-31T23:59:59' });
    b.changePin(m.id, '5151', '0000');
    assert.equal(b.listUsers().find(u => u.id === m.id)!.pin_expires_at, null);
    assert.equal(b.listUsers().find(u => u.id === m.id)!.must_change_pin, 0);
    // v1.5.1 §4: rotation — default 90, garbage config rejected, window
    // audited, due forces change, countdown rides verify, NULL clock fresh.
    assert.equal(b.getPinRotationDays(), 90);
    assert.throws(() => b.setPinRotationDays(0, 'owner'), /1-365/);
    assert.throws(() => b.setPinRotationDays(400, 'owner'), /1-365/);
    assert.throws(() => b.setPinRotationDays(45.5, 'owner'), /1-365/);
    b.setPinRotationDays(30, 'owner');
    assert.equal(b.getPinRotationDays(), 30);
    const rotAudit = b.listAudit(100).filter(a => a.action === 'users.rotation_config' && /days=30/.test(a.detail ?? ''));
    assert.equal(rotAudit.length, 1, 'window audited');
    b.setPinRotationDays(90, 'owner');
    b.db.prepare('UPDATE users SET pin_changed_at = NULL WHERE id = ?').run(m.id);
    const nullClock = b.verifyUser('sara', '0000');
    assert.equal(nullClock.ok, true);
    if (nullClock.ok) {
      assert.equal(nullClock.user.rotation_due, false);
      assert.equal(nullClock.user.rotation_days_left, 90);
    }
    b.db.prepare("UPDATE users SET pin_changed_at = '2000-01-01T00:00:00' WHERE id = ?").run(m.id);
    const due = b.verifyUser('sara', '0000');
    assert.equal(due.ok, true);
    if (due.ok) {
      assert.equal(due.user.rotation_due, true);
      assert.ok((due.user.rotation_days_left ?? 1) <= 0);
    }
    b.db.prepare("UPDATE users SET pin_changed_at = strftime('%Y-%m-%dT%H:%M:%S','now') WHERE id = ?").run(m.id);
    const fresh = b.verifyUser('sara', '0000');
    assert.equal(fresh.ok, true);
    if (fresh.ok) {
      assert.equal(fresh.user.rotation_due, false);
      assert.ok((fresh.user.rotation_days_left ?? 0) > 80);
    }
    assert.ok(b.listUsers().find(u => u.id === m.id)!.pin_changed_at, 'clock visible in list');
    const audit = b.listAudit(50).map(a => a.action);
    for (const a of ['user.create', 'login.ok', 'login.fail', 'user.deactivate', 'pin.change', 'pin.reset', 'users.rotation_config'] as const) {
      assert.ok(audit.includes(a), `audit must contain ${a}`);
    }
    b.close();
  } finally {
    cleanup(p);
  }
});

test('T8b: provisioned accounts start forced-change, blank names fall back', () => {
  const p = tmpFile('rbac');
  try {
    const b = openBarakaDb(p);
    const m = b.createUser({ username: 'Lina', display_name: '   ', role: 'cashier', pin: '4321' }, 'owner');
    assert.equal(m.username, 'lina');
    assert.equal(m.display_name, 'lina');
    assert.equal(m.must_change_pin, 1);
    assert.equal(b.verifyUser('lina', '4321').ok, true);
    b.close();
  } finally {
    cleanup(p);
  }
});

test('T8/T11: legacy v3 file climbs to v11 and reseeds the owner', () => {
  const p = tmpFile('rbac');
  try {
    const b = openBarakaDb(p);
    b.db.exec(`DROP TABLE users; DROP TABLE audit_log;
      DROP TRIGGER IF EXISTS trg_sales_no_delete; DROP TRIGGER IF EXISTS trg_sale_items_no_delete;
      DROP TRIGGER IF EXISTS trg_settlements_no_delete; DROP TRIGGER IF EXISTS trg_sales_terminal;
      DROP TRIGGER IF EXISTS trg_users_no_delete; DROP TRIGGER IF EXISTS trg_audit_no_delete;
      DROP TRIGGER IF EXISTS trg_audit_no_update; PRAGMA user_version = 3;`);
    b.close();
    const c = openBarakaDb(p);
    const users = c.listUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0].username, 'owner');
    assert.equal(c.verifyUser('owner', '1234').ok, true);
    assert.equal((c.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 11);
    c.close();
  } finally {
    cleanup(p);
  }
});
