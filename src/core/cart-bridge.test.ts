import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLineTotals as legacyLine, calculateSaleTotals as legacySale } from '../utils/fiscal.js';
import { calculateLineTotals, calculateSaleTotals } from './cart-bridge.js';
import type { SaleItem } from '../types/index.js';

test('bridge: line totals match legacy floats within 1ct across the grid', () => {
  for (const price of [45, 120, 180, 280, 650, 999.99]) {
    for (const qty of [1, 2, 1.45, 3.7]) {
      for (const rate of [0, 9, 19] as const) {
        for (const disc of [0, 10]) {
          const a = legacyLine(price, qty, rate, disc);
          const c = calculateLineTotals(price, qty, rate, disc);
          for (const k of ['total_line_ht', 'total_line_tva', 'total_line_ttc'] as const) {
            assert.ok(Math.abs(a[k] - c[k]) * 100 <= 1.01, `${price}x${qty} tva${rate} -${disc}% ${k}: ${a[k]} vs ${c[k]}`);
          }
        }
      }
    }
  }
});

test('bridge: golden receipt identical to legacy legal values', () => {
  const mk = (product_id: number, unit_price_ttc: number, quantity: number, tva_rate: 0 | 9 | 19, ht: number, tva: number, ttc: number): SaleItem => ({
    product_id, barcode: 'x', name_fr: 'n', name_ar: '', unit_price_ttc, quantity,
    unit: 'PIECE', tva_rate, discount_percent: 0,
    total_line_ht: ht, total_line_tva: tva, total_line_ttc: ttc,
  });
  const items: SaleItem[] = [
    mk(1, 180, 2, 9, 330.28, 29.72, 360),
    mk(2, 650, 1, 0, 650, 0, 650),
    mk(3, 120, 3, 19, 302.52, 57.48, 360),
  ];
  const a = legacySale(items, 'ESPECES');
  const c = calculateSaleTotals(items, 'ESPECES');
  assert.equal(c.timbre_fiscal, a.timbre_fiscal);
  assert.equal(c.total_ttc, a.total_ttc);
  assert.equal(c.total_ht, a.total_ht);
  assert.equal(c.tva_breakdown[9].total_ttc, a.tva_breakdown[9].total_ttc);
});
