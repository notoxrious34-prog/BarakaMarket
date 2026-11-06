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

test('T8/T11: fresh DB seeds the owner at latest schema (v10)', () => {
  const p = tmpFile('rbac');
  try {
    const b = openBarakaDb(p);
    assert.equal(LATEST_SCHEMA_VERSION, 10);
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
    const audit = b.listAudit(50).map(a => a.action);
    for (const a of ['user.create', 'login.ok', 'login.fail', 'user.deactivate', 'pin.change'] as const) {
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

test('T8/T11: legacy v3 file climbs to v10 and reseeds the owner', () => {
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
    assert.equal((c.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 10);
    c.close();
  } finally {
    cleanup(p);
  }
});
