import test from 'node:test';
import assert from 'node:assert/strict';
import { dzdToCentimes } from './money.js';
import { calculateCashChange, smartCashPresetsCt } from './fiscal.centimes.js';

// ---- ADR-005-MKT: cash tender cockpit math (strict integer centimes) ----
test('cash: exact tender -> zero change, valid', () => {
  const r = calculateCashChange(143000, 143000);
  assert.equal(r.changeCt, 0);
  assert.equal(r.isValid, true);
  assert.equal(r.deficitCt, 0);
});

test('cash: 2000 tendered on 1430 total -> 570 change', () => {
  const r = calculateCashChange(143000, 200000);
  assert.equal(r.changeCt, 57000);
  assert.equal(r.isValid, true);
  assert.equal(r.deficitCt, 0);
});

test('cash: underpayment -> invalid with exact deficit', () => {
  const r = calculateCashChange(143000, 100000);
  assert.equal(r.isValid, false);
  assert.equal(r.changeCt, 0);
  assert.equal(r.deficitCt, 43000);
});

test('cash: tender input converts Dinars to centimes exactly', () => {
  const tenderedCt = dzdToCentimes(2000);
  assert.equal(tenderedCt, 200000);
  const r = calculateCashChange(143000, tenderedCt);
  assert.equal(r.changeCt, 57000);
});

test('cash: guards reject non-integer money', () => {
  assert.throws(() => calculateCashChange(143000.5, 200000), /integer/i);
  assert.throws(() => calculateCashChange(143000, NaN), /integer/i);
});

test('cash: presets for 1430 DZD -> exact, 2000, 5000', () => {
  assert.deepEqual(smartCashPresetsCt(143000), [143000, 200000, 500000]);
});

test('cash: presets for 300 DZD include small notes', () => {
  assert.deepEqual(smartCashPresetsCt(30000), [30000, 50000, 100000, 200000, 500000]);
});

test('cash: presets for 2400 DZD -> next x1000=3000? next x2000=4000', () => {
  assert.deepEqual(smartCashPresetsCt(240000), [240000, 300000, 400000, 500000]);
});
