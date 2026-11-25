/**
 * ADR-053 P3 — pin-authority pure tests (RED law: merge + lane contracts).
 * Lane I/O (invoke/fetch) is covered by the Rust + BarakaDb suites;
 * here we pin the UI-cache merge semantics.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergePinsInto } from './pin-authority.js';
import type { Product } from '../types/index.js';

const BASE: Product = {
  id: 31, barcode: '', name_fr: 'OEUF', name_ar: '', category_id: 'c',
  buy_price: 0, sell_price: 300, tva_rate: 0,
  stock_qty: 0, min_stock_alert: 0, unit: 'PIECE',
  has_expiry_date: false, expiry_date: '',
};

describe('pin-authority mergePinsInto', () => {
  it('overlays DB pins by id and converts ct/kg + 0/1 track', () => {
    const pins = [{
      id: 31, pin_order: 2, pin_color: 'amber', pin_icon: '🥚',
      kind: 'POIDS', price_per_kg_ct: 30000, tare_g: 40, track_stock: 1,
      pinned_until: '2027-01-01',
    }] as unknown as Product[];
    const out = mergePinsInto([BASE], pins);
    assert.equal(out[0].pin_order, 2);
    assert.equal(out[0].pin_color, 'amber');
    assert.equal(out[0].kind, 'POIDS');
    assert.equal(out[0].price_per_kg, 300);
    assert.equal(out[0].track_stock, true);
  });

  it('ignores unknown ids and returns the same array when nothing matched', () => {
    const pins = [{ id: 99, pin_order: 1 } as unknown as Product];
    const before = [BASE];
    const out = mergePinsInto(before, pins);
    assert.equal(out, before); // identity: no re-render churn
  });

  it('empty lane is identity', () => {
    const before = [BASE];
    assert.equal(mergePinsInto(before, []), before);
  });
});
