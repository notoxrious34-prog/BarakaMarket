/**
 * TASK-MKT-001: pure cart-state operations — append/merge, qty, discount, remove.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addCartLine, updateCartLineQty, updateCartLineDiscount, removeCartLine } from './cart-state';
import type { Product } from '../types';

const P = (over: Partial<Product> = {}): Product => ({
  id: 3,
  barcode: '6130000000014',
  name_fr: 'LAIT',
  name_ar: 'حليب',
  sell_price: 180,
  unit: 'PIECE',
  tva_rate: 9 as const,
  stock: 100,
  ...over,
} as Product);

describe('cart-state (TASK-MKT-001 pure ops)', () => {
  it('appends a fresh line with line totals', () => {
    const next = addCartLine([], P(), 2);
    assert.equal(next.length, 1);
    assert.equal(next[0].quantity, 2);
    assert.equal(next[0].total_line_ttc, 360);
    assert.equal(next[0].barcode, '6130000000014');
  });
  it('merges same product + same price + same pack', () => {
    const one = addCartLine([], P(), 1);
    const two = addCartLine(one, P(), 2);
    assert.equal(two.length, 1);
    assert.equal(two[0].quantity, 3);
    assert.equal(two[0].total_line_ttc, 540);
  });
  it('splits lines when the pack differs', () => {
    const one = addCartLine([], P(), 1);
    const two = addCartLine(one, P(), 1, 0, { packName: 'Pack x6', packMultiplier: 6, unitPriceTtc: 1000 });
    assert.equal(two.length, 2);
    assert.equal(two[1].name_fr, 'LAIT [Pack x6]');
  });
  it('updateQty recomputes totals; <=0 removes the line', () => {
    const one = addCartLine([], P(), 1);
    const up = updateCartLineQty(one, 0, 4);
    assert.equal(up[0].quantity, 4);
    assert.equal(up[0].total_line_ttc, 720);
    assert.deepEqual(updateCartLineQty(one, 0, 0), []);
    assert.deepEqual(updateCartLineQty(one, 9, 2), one);
  });
  it('updateDiscount recomputes totals; remove drops by index', () => {
    const one = addCartLine([], P(), 2);
    const d = updateCartLineDiscount(one, 0, 10);
    assert.equal(d[0].discount_percent, 10);
    assert.equal(d[0].total_line_ttc, 324);
    assert.deepEqual(removeCartLine(d, 0), []);
    assert.deepEqual(updateCartLineDiscount(one, 9, 10), one);
  });
  it('never mutates the input array', () => {
    const one = addCartLine([], P(), 1);
    const frozen = [...one];
    addCartLine(one, P(), 1);
    updateCartLineQty(one, 0, 5);
    assert.deepEqual(one, frozen);
  });
});
