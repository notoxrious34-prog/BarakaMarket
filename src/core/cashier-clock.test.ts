/**
 * TASK-MKT-003: cashier-clock formatting is pure and pinned.
 * Latin digits only, zero-padded, 24h clock + DD/MM stamp.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCashierClock } from './cashier-clock.js';

test('cashier clock pads single digits and uses 24h latin time', () => {
  const p = formatCashierClock(new Date(2026, 10, 10, 9, 5, 7));
  assert.equal(p.clock, '09:05:07');
  assert.equal(p.dayStamp, '10/11');
});

test('cashier clock handles midnight and year boundary', () => {
  const p = formatCashierClock(new Date(2026, 0, 1, 0, 0, 0));
  assert.equal(p.clock, '00:00:00');
  assert.equal(p.dayStamp, '01/01');
});

test('cashier clock never emits locale-shaped digits', () => {
  const p = formatCashierClock(new Date(2026, 5, 15, 23, 59, 59));
  assert.match(p.clock, /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/);
  assert.match(p.dayStamp, /^[0-9]{2}\/[0-9]{2}$/);
  assert.equal(p.clock, '23:59:59');
  assert.equal(p.dayStamp, '15/06');
});
