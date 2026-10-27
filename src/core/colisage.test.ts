import test from 'node:test';
import assert from 'node:assert/strict';
import { effectivePackPriceCt, packDeductionMilli } from './cart-bridge.js';

// ---- ADR-004-MKT colisage math (pure, integer-first) ----
test('colisage: alias x1 resolves at exact unit price', () => {
  assert.equal(effectivePackPriceCt(18000, 1), 18000);
  assert.equal(effectivePackPriceCt(3500, 1, null), 3500);
});

test('colisage: pack x6 defaults to unit x multiplier', () => {
  assert.equal(effectivePackPriceCt(3500, 6), 21000);
  assert.equal(effectivePackPriceCt(4500, 12), 54000);
});

test('colisage: price_override_ct wins over multiplier math', () => {
  assert.equal(effectivePackPriceCt(3500, 6, 18000), 18000);
  assert.equal(effectivePackPriceCt(3500, 6, 0), 0);
});

test('colisage: guards reject bad multiplier / non-integer money', () => {
  assert.throws(() => effectivePackPriceCt(3500, 0), />= 1/);
  assert.throws(() => effectivePackPriceCt(3500.5, 6), /integer/i);
  assert.throws(() => effectivePackPriceCt(3500, 6, 18.5), /integer/i);
});

test('colisage: 2 packs x6 drain exactly 12000 milli-units', () => {
  assert.equal(packDeductionMilli(2, 6), 12000);
  assert.equal(packDeductionMilli(1, 1), 1000);
  assert.equal(packDeductionMilli(3, 12), 36000);
  assert.throws(() => packDeductionMilli(0, 6), /> 0/);
  assert.throws(() => packDeductionMilli(2, 0), />= 1/);
});
