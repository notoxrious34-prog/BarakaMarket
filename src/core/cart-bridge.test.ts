import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLineTotals, calculateSaleTotals } from './cart-bridge.js';
import { calculateLineTotalsCt } from './fiscal.centimes.js';
import { dzdToCentimes } from './money.js';
import type { SaleItem } from '../types/index.js';

// Directive EXEC-DIR-2023-001: bridge must run on integer centimes.
// No legacy float imports — goldens are hardcoded from Art. 23 CTCA.

test('bridge: line totals match integer engine exactly across the grid', () => {
  for (const price of [45, 120, 180, 280, 650, 999.99]) {
    for (const qty of [1, 2, 1.45, 3.7]) {
      for (const rate of [0, 9, 19] as const) {
        for (const disc of [0, 10]) {
          const a = calculateLineTotalsCt(dzdToCentimes(price), qty, rate, disc);
          const c = calculateLineTotals(price, qty, rate, disc);
          assert.equal(c.total_line_ht, a.total_line_ht_ct / 100, `${price}x${qty} tva${rate} -${disc}% ht`);
          assert.equal(c.total_line_tva, a.total_line_tva_ct / 100, `${price}x${qty} tva${rate} -${disc}% tva`);
          assert.equal(c.total_line_ttc, a.total_line_ttc_ct / 100, `${price}x${qty} tva${rate} -${disc}% ttc`);
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
  const c = calculateSaleTotals(items, 'ESPECES');
  // 1370 TTC -> ceil(13.70) = 14 DZD timbre -> 1384 final
  assert.equal(c.timbre_fiscal, 14);
  assert.equal(c.total_ttc, 1384);
  assert.equal(c.total_ht, 1282.8);
  assert.equal(c.tva_breakdown[9].total_ttc, 360);
});
