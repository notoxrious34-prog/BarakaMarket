import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toNativeProduct, syncCatalogToNative, listNativeProducts } from './product-authority.js';
import type { Product } from '../types/index.js';

/**
 * T4c (ADR-027): one-way catalog mirror UI -> native SQLite.
 * Outside Tauri everything is a deliberate no-op; the mapping is pure
 * centimes/milli rounding (the same integer lane as the fiscal engine).
 */
const SAMPLE: Product = {
  id: 7, barcode: '613000000001', name_fr: 'LAIT', name_ar: 'حليب',
  category_id: 'c1', buy_price: 120, sell_price: 180.5, tva_rate: 9,
  stock_qty: 48, min_stock_alert: 5, unit: 'PIECE',
  is_scale_product: false, has_expiry_date: false,
};

describe('product authority (T4c)', () => {
  it('maps UI product to native centimes/milli payload', () => {
    const n = toNativeProduct(SAMPLE);
    assert.equal(n.sell_price_ct, 18050);
    assert.equal(n.buy_price_ct, 12000);
    assert.equal(n.stock_milli, 48000);
    assert.equal(n.min_stock_milli, 5000);
    assert.equal(n.tva_rate, 9);
  });

  it('maps fractional KG stock to milli without float drift', () => {
    const n = toNativeProduct({ ...SAMPLE, unit: 'KG', stock_qty: 1.45, sell_price: 280 });
    assert.equal(n.stock_milli, 1450);
    assert.equal(n.sell_price_ct, 28000);
  });

  it('outside Tauri: sync is a no-op, list is null (browser lane untouched)', async () => {
    const { synced } = await syncCatalogToNative([SAMPLE]);
    assert.equal(synced, 0);
    assert.equal(await listNativeProducts(), null);
  });
});
