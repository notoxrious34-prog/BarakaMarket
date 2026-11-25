import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRapideAdd, validateRapideInput, RAPIDE_PID, RAPIDE_BARCODE } from './rapide';
import { addCartLine } from './cart-state';
import type { Product } from '../types';

const catalogBread: Product = {
  id: 7, barcode: '613000000001', name_fr: 'Pain', name_ar: 'خبز',
  category_id: 'boulangerie', buy_price: 20, sell_price: 30, tva_rate: 9,
  stock_qty: 100, min_stock_alert: 5, unit: 'PIECE', has_expiry_date: false,
};

describe('rapide ADR-051 P0: builder + validation', () => {
  it('synthesizes the pid-0 marker product with the label in the pack', () => {
    const r = buildRapideAdd({ label: 'خبز الشعير', priceTtcCt: 3000, quantity: 2, tva: 9, unit: 'PIECE' });
    assert.equal(r.product.id, RAPIDE_PID);
    assert.equal(r.product.barcode, RAPIDE_BARCODE);
    assert.equal(r.pack.packName, 'خبز الشعير');
    assert.equal(r.product.sell_price, 30);
    assert.equal(r.quantity, 2);
  });
  it('line totals match a catalog product at the same price/tva (parity)', () => {
    const r = buildRapideAdd({ label: 'X', priceTtcCt: 3000, quantity: 2, tva: 9, unit: 'PIECE' });
    const viaRapide = addCartLine([], r.product, r.quantity, 0, r.pack);
    const viaCatalog = addCartLine([], catalogBread, 2);
    assert.equal(viaRapide[0].total_line_ttc, viaCatalog[0].total_line_ttc);
    assert.equal(viaRapide[0].total_line_ht, viaCatalog[0].total_line_ht);
    assert.equal(viaRapide[0].total_line_tva, viaCatalog[0].total_line_tva);
  });
  it('R1: same label+price merges, distinct labels never merge', () => {
    const a = buildRapideAdd({ label: 'A', priceTtcCt: 3000, quantity: 1, tva: 9, unit: 'PIECE' });
    const a2 = buildRapideAdd({ label: 'A', priceTtcCt: 3000, quantity: 1, tva: 9, unit: 'PIECE' });
    const b = buildRapideAdd({ label: 'B', priceTtcCt: 3000, quantity: 1, tva: 9, unit: 'PIECE' });
    let cart = addCartLine([], a.product, a.quantity, 0, a.pack);
    cart = addCartLine(cart, a2.product, a2.quantity, 0, a2.pack);
    assert.equal(cart.length, 1);
    assert.equal(cart[0].quantity, 2);
    cart = addCartLine(cart, b.product, b.quantity, 0, b.pack);
    assert.equal(cart.length, 2);
  });
  it('refuses bad label / price / qty / tva', () => {
    const bad = { label: 'x', priceTtcCt: 0, quantity: 0, tva: 9 as const, unit: 'PIECE' as const };
    assert.deepEqual(validateRapideInput(bad).sort(), ['LABEL', 'PRICE', 'QTY']);
    assert.deepEqual(validateRapideInput({ label: 'خبز', priceTtcCt: 3000, quantity: 1, tva: 7 as never, unit: 'PIECE' }), ['TVA']);
    assert.deepEqual(validateRapideInput({ label: 'خبز', priceTtcCt: 3000, quantity: 1, tva: 9, unit: 'PIECE' }), []);
  });
});
