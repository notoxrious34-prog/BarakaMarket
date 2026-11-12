/**
 * B3: `N*CODE` prefix — one scan carries the quantity (12 bottles, 3 keys).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQtyPrefix } from './barcode-qty.js';

test('B3: plain codes pass through untouched', () => {
  assert.deepEqual(parseQtyPrefix('613000000021'), { mult: 1, core: '613000000021', hadPrefix: false });
  assert.deepEqual(parseQtyPrefix('  613000000021  '), { mult: 1, core: '613000000021', hadPrefix: false });
});

test('B3: N*CODE splits multiplier from code', () => {
  assert.deepEqual(parseQtyPrefix('12*613000000021'), { mult: 12, core: '613000000021', hadPrefix: true });
  assert.deepEqual(parseQtyPrefix('3*EAU-15L'), { mult: 3, core: 'EAU-15L', hadPrefix: true });
});

// OWNER-2026-11-12 (Caisse): `0,5*9305` (Algerian comma) must weigh half a
// kilo — the scanner field rejected it as "introuvable".
test('B3: decimal multipliers accept comma and dot (grams/kilos)', () => {
  assert.deepEqual(parseQtyPrefix('0,5*9305'), { mult: 0.5, core: '9305', hadPrefix: true });
  assert.deepEqual(parseQtyPrefix('0.5*9305'), { mult: 0.5, core: '9305', hadPrefix: true });
  assert.deepEqual(parseQtyPrefix('2,250*EAU-15L'), { mult: 2.25, core: 'EAU-15L', hadPrefix: true });
  assert.deepEqual(parseQtyPrefix('  1,5 * 9305  '), { mult: 1.5, core: '9305', hadPrefix: true });
});

test('B3: degenerate prefixes clamp, never zero-out', () => {
  assert.equal(parseQtyPrefix('0*X').mult, 1);
  assert.equal(parseQtyPrefix('0,0*X').mult, 1);
  assert.equal(parseQtyPrefix('1500*X').mult, 999);
  assert.equal(parseQtyPrefix('2*').core, '2*');
});

test('B3: scale labels and fuzzy text without star stay mult 1', () => {
  assert.deepEqual(parseQtyPrefix('2812345001234'), { mult: 1, core: '2812345001234', hadPrefix: false });
  assert.equal(parseQtyPrefix('lait').mult, 1);
});
