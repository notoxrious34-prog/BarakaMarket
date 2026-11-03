import test from 'node:test';
import assert from 'node:assert/strict';
import { reverseReceiptLines, applyReceiptLines, editReceiptLines } from './purchase-lane.js';
import type { PurchaseItem } from '../types/index.js';

const prod = (id: number, stock_qty: number, buy_price: number) => ({ id, stock_qty, buy_price });
const line = (product_id: number, quantity: number, unit_buy_price_ht: number): PurchaseItem => ({
  product_id, barcode: 'x', name_fr: `P${product_id}`, name_ar: '', quantity,
  unit: 'PIECE', unit_buy_price_ht, tva_rate: 9, unit_sell_price_ttc: 0,
  total_line_ht: quantity * unit_buy_price_ht, total_line_ttc: 0,
});

test('purchase-lane: delete reverses stock and backs out PMP exactly', () => {
  // 10 @100 then +10 @120 => PMP 110, stock 20.
  let ps = [prod(1, 10, 100)];
  ps = applyReceiptLines(ps, [line(1, 10, 120)]);
  assert.equal(ps[0].stock_qty, 20);
  assert.equal(ps[0].buy_price, 110);
  const rev = reverseReceiptLines(ps, [line(1, 10, 120)]);
  assert.equal(rev.error, null);
  assert.equal(rev.products![0].stock_qty, 10);
  assert.equal(rev.products![0].buy_price, 100);
});

test('purchase-lane: delete refused when goods were sold since (no negative stock)', () => {
  const ps = [prod(1, 4, 100)]; // only 4 left of a 10-unit receipt
  const rev = reverseReceiptLines(ps, [line(1, 10, 120)]);
  assert.equal(rev.products, null);
  assert.match(rev.error!, /insuffisant|refusée/);
});

test('purchase-lane: delete refused for unknown product', () => {
  const rev = reverseReceiptLines([prod(1, 50, 100)], [line(999, 5, 10)]);
  assert.equal(rev.products, null);
  assert.match(rev.error!, /introuvable/);
});

test('purchase-lane: delete of the whole stock resets PMP to the line price', () => {
  const rev = reverseReceiptLines([prod(1, 10, 110)], [line(1, 10, 120)]);
  assert.equal(rev.error, null);
  assert.equal(rev.products![0].stock_qty, 0);
  assert.equal(rev.products![0].buy_price, 120);
});

test('purchase-lane: edit = reverse old + apply new, invoice math stays caller-side', () => {
  const ps = [prod(1, 20, 110)];
  const out = editReceiptLines(ps, [line(1, 10, 120)], [line(1, 6, 140)]);
  assert.equal(out.error, null);
  // reverse: 20-10=10 @100 ; apply 6 @140 => (10*100+6*140)/16 = 115
  assert.equal(out.products![0].stock_qty, 16);
  assert.equal(out.products![0].buy_price, 115);
});

test('purchase-lane: edit refused when the old receipt can no longer be reversed', () => {
  const out = editReceiptLines([prod(1, 2, 100)], [line(1, 10, 120)], [line(1, 1, 1)]);
  assert.equal(out.products, null);
  assert.match(out.error!, /insuffisant|refusée/);
});
