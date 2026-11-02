/**
 * B3: `N*CODE` prefix — one scan carries the quantity (12 bottles, 3 keys).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQtyPrefix } from './barcode-qty.js';

test('B3: plain codes pass through untouched', () => {
  assert.deepEqual(parseQtyPrefix('613000000021'), { mult: 1, core: '613000000021' });
  assert.deepEqual(parseQtyPrefix('  613000000021  '), { mult: 1, core: '613000000021' });
});

test('B3: N*CODE splits multiplier from code', () => {
  assert.deepEqual(parseQtyPrefix('12*613000000021'), { mult: 12, core: '613000000021' });
  assert.deepEqual(parseQtyPrefix('3*EAU-15L'), { mult: 3, core: 'EAU-15L' });
});

test('B3: degenerate prefixes clamp, never zero-out', () => {
  assert.equal(parseQtyPrefix('0*X').mult, 1);
  assert.equal(parseQtyPrefix('1500*X').mult, 999);
});

test('B3: scale labels and fuzzy text without star stay mult 1', () => {
  assert.deepEqual(parseQtyPrefix('2812345001234'), { mult: 1, core: '2812345001234' });
  assert.equal(parseQtyPrefix('lait').mult, 1);
});
