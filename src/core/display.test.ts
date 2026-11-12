/**
 * OWNER-2026-11-12 (Caisse): the weight unit is the GRAM, not the kilo.
 * `formatGrams` is the single display binding — internals stay kg/milli.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGrams } from './display.js';

test('formatGrams renders whole grams with a latin g', () => {
  assert.equal(formatGrams(0.5), '500 g');
  assert.equal(formatGrams(1.45), '1450 g');
  assert.equal(formatGrams(2), '2000 g');
  assert.equal(formatGrams(0), '0 g');
});

test('formatGrams rounds half-up at the gram boundary, never NaN', () => {
  assert.equal(formatGrams(0.0005), '1 g');
  assert.equal(formatGrams(NaN), '0 g');
});
