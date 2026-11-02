/**
 * C1: touch keypad — digits, single dot, clear, backspace, length cap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { touchAmountKey } from './touch-amount.js';

test('C1: digits append; leading zero collapses', () => {
  assert.equal(touchAmountKey('', '1'), '1');
  assert.equal(touchAmountKey('12', '0'), '120');
  assert.equal(touchAmountKey('0', '5'), '5');
});

test('C1: one dot only, 0.-prefixed when empty', () => {
  assert.equal(touchAmountKey('', '.'), '0.');
  assert.equal(touchAmountKey('12', '.'), '12.');
  assert.equal(touchAmountKey('12.5', '.'), '12.5');
});

test('C1: 00 / C / backspace', () => {
  assert.equal(touchAmountKey('', '00'), '0');
  assert.equal(touchAmountKey('5', '00'), '500');
  assert.equal(touchAmountKey('123', 'C'), '');
  assert.equal(touchAmountKey('123', 'back'), '12');
  assert.equal(touchAmountKey('', 'back'), '');
});

test('C1: length cap holds (no overflow tender)', () => {
  assert.equal(touchAmountKey('123456789', '9'), '123456789');
  assert.equal(touchAmountKey('12345678', '00'), '12345678');
});
