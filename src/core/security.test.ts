import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidPinFormat, createPinHash, verifyPin, safeEqual, DEFAULT_MANAGER_PIN,
} from './security.js';
import { requiresOverride, buildVoidLogEntry, PROTECTED_ACTIONS } from './manager-override.js';

test('security: PIN format accepts 4-8 digits only', () => {
  assert.equal(isValidPinFormat('1234'), true);
  assert.equal(isValidPinFormat('12345678'), true);
  assert.equal(isValidPinFormat('123'), false);
  assert.equal(isValidPinFormat('123456789'), false);
  assert.equal(isValidPinFormat('12a4'), false);
  assert.equal(isValidPinFormat(''), false);
  assert.equal(DEFAULT_MANAGER_PIN, '1234');
});

test('security: hash round-trip with unique salts, wrong PIN fails', () => {
  const h1 = createPinHash('9876');
  const h2 = createPinHash('9876');
  assert.notEqual(h1, h2);
  assert.equal(verifyPin('9876', h1), true);
  assert.equal(verifyPin('9876', h2), true);
  assert.equal(verifyPin('9877', h1), false);
  assert.equal(verifyPin('', h1), false);
  assert.throws(() => createPinHash('12'), /4-8 numeric/);
});

test('security: default fallback and malformed verifiers', () => {
  assert.equal(verifyPin('1234', null), true);
  assert.equal(verifyPin('1234', undefined), true);
  assert.equal(verifyPin('0000', null), false);
  assert.equal(verifyPin('1234', 'garbage-no-separator'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('abc', 'abc'), true);
});

test('security: all four POS actions are override-gated with audit payload', () => {
  assert.deepEqual([...PROTECTED_ACTIONS].sort(), ['CART_CLEAR', 'DRAWER_KICK', 'LINE_VOID', 'MANUAL_DISCOUNT']);
  for (const action of PROTECTED_ACTIONS) assert.equal(requiresOverride(action), true);
  const entry = buildVoidLogEntry({
    action: 'MANUAL_DISCOUNT', amountCt: 25000, cashierName: 'Yacine',
    reason: 'geste commercial', managerApprovedBy: 'Hadj',
  });
  assert.equal(entry.actionType, 'MANUAL_DISCOUNT');
  assert.equal(entry.amountCt, 25000);
  assert.throws(() => buildVoidLogEntry({
    action: 'HACK' as never, amountCt: 1, cashierName: 'Y', reason: 'x',
  }), /unknown protected action/);
  assert.throws(() => buildVoidLogEntry({
    action: 'LINE_VOID', amountCt: -1, cashierName: 'Y', reason: 'x',
  }), /non-negative/);
  assert.throws(() => buildVoidLogEntry({
    action: 'LINE_VOID', amountCt: 1, cashierName: ' ', reason: 'x',
  }), /cashierName/);
});
