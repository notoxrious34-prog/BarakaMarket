/**
 * ADR-046 Tier 3: the sale is refused explicitly when a line exceeds the
 * available stock — never a silent zero, never a misleading "introuvable".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStockAvailability } from './stock-guard.js';

const STOCKS = [
  { id: 1, stock_qty: 48 },
  { id: 2, stock_qty: 0.3 },
];

test('stock-guard: sufficient lines pass (units + KG decimals + packs)', () => {
  assert.equal(
    checkStockAvailability(
      [
        { product_id: 1, name_fr: 'Lait', quantity: 12 },
        { product_id: 2, name_fr: 'Pommes', quantity: 0.25 },
        { product_id: 1, name_fr: 'Lait x6', quantity: 2, packMultiplier: 6 },
      ],
      STOCKS,
    ),
    null,
  );
});

test('stock-guard: over-selling refuses with available + requested', () => {
  assert.deepEqual(
    checkStockAvailability([{ product_id: 1, name_fr: 'Lait', quantity: 50 }], STOCKS),
    { product_id: 1, name: 'Lait', available: 48, requested: 50 },
  );
});

test('stock-guard: KG boundary is exact at the milli (0.301 > 0.300)', () => {
  assert.deepEqual(
    checkStockAvailability([{ product_id: 2, name_fr: 'Pommes', quantity: 0.301 }], STOCKS),
    { product_id: 2, name: 'Pommes', available: 0.3, requested: 0.301 },
  );
  assert.equal(
    checkStockAvailability([{ product_id: 2, name_fr: 'Pommes', quantity: 0.3 }], STOCKS),
    null,
  );
});

test('stock-guard: packs drain multiplier x base; ad-hoc lines skip', () => {
  assert.deepEqual(
    checkStockAvailability(
      [{ product_id: 1, name_fr: 'Lait x6', quantity: 9, packMultiplier: 6 }],
      STOCKS,
    )?.requested,
    54,
  );
  assert.equal(
    checkStockAvailability([{ product_id: null, name_fr: 'Divers', quantity: 999 }], STOCKS),
    null,
  );
});
