import test from 'node:test';
import assert from 'node:assert/strict';
import { openBarakaDb } from './sqlite.js';

const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};

const MILK = {
  id: 1, barcode: '6130000000014', name_fr: 'LAIT', name_ar: 'حليب',
  category_id: 'laiterie', buy_price_ct: 14500, sell_price_ct: 18000,
  tva_rate: 9 as const, stock_milli: 48000, min_stock_milli: 10000,
  unit: 'PIECE' as const, is_scale: 0, scale_item_code: null,
  has_expiry: 1, expiry_date: day(30),
};

test('loss: table + indexes provisioned on open', () => {
  const b = openBarakaDb(':memory:');
  const tables = (b as unknown as { db: { prepare: (s: string) => { all: () => { name: string }[] } } }).db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_losses'").all();
  assert.equal(tables.length, 1);
  const idx = (b as unknown as { db: { prepare: (s: string) => { all: () => { name: string }[] } } }).db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='inventory_losses'").all()
    .map(r => r.name).sort();
  assert.deepEqual(idx, ['idx_inventory_losses_created', 'idx_inventory_losses_product']);
  b.close();
});

test('loss: EXPIRED write-off decrements stock atomically', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(MILK);
  const out = b.recordInventoryLoss({ product_id: 1, qty_milli: 2000, reason: 'EXPIRED', unit_cost_ct: 14500 });
  assert.equal(out.stock_milli, 46000);
  assert.equal(b.getProduct(1).stock_milli, 46000);
  const rows = b.getInventoryLosses();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'EXPIRED');
  assert.equal(rows[0].qty_milli, 2000);
  assert.equal(rows[0].total_loss_ct, 29000);
  b.close();
});

test('loss: explicit total_loss_ct respected over computed default', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(MILK);
  b.recordInventoryLoss({ product_id: 1, qty_milli: 1000, reason: 'BROKEN', unit_cost_ct: 14500, total_loss_ct: 15000, notes: 'shelf fall' });
  const rows = b.getInventoryLosses();
  assert.equal(rows[0].total_loss_ct, 15000);
  assert.equal(rows[0].notes, 'shelf fall');
  b.close();
});

test('loss: qty exceeding stock throws and leaves ledger + stock untouched', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(MILK);
  assert.throws(
    () => b.recordInventoryLoss({ product_id: 1, qty_milli: 49000, reason: 'THEFT' }),
    /exceeds stock/,
  );
  assert.equal(b.getProduct(1).stock_milli, 48000);
  assert.equal(b.getInventoryLosses().length, 0);
  b.close();
});

test('loss: unknown reason rejected before touching stock', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(MILK);
  assert.throws(
    () => b.recordInventoryLoss({ product_id: 1, qty_milli: 1000, reason: 'SPOILED' as never }),
    /invalid loss reason/,
  );
  assert.equal(b.getProduct(1).stock_milli, 48000);
  b.close();
});

test('loss: zero qty and negative costs rejected', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(MILK);
  assert.throws(() => b.recordInventoryLoss({ product_id: 1, qty_milli: 0, reason: 'DAMAGED' }), /positive integer/);
  assert.throws(() => b.recordInventoryLoss({ product_id: 1, qty_milli: 1000, reason: 'DAMAGED', unit_cost_ct: -5 }), />= 0/);
  assert.equal(b.getInventoryLosses().length, 0);
  b.close();
});

test('loss: RESTRICT blocks deleting a product with loss history', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(MILK);
  b.recordInventoryLoss({ product_id: 1, qty_milli: 1000, reason: 'INTERNAL_USE' });
  assert.throws(() => {
    (b as unknown as { db: { exec: (s: string) => void } }).db.exec('DELETE FROM products WHERE id = 1');
  }, /FOREIGN KEY/i);
  b.close();
});

test('loss: query filters by reason, product and date range', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(MILK);
  b.upsertProduct({ ...MILK, id: 2, barcode: '6130000000021' });
  b.recordInventoryLoss({ product_id: 1, qty_milli: 1000, reason: 'EXPIRED', created_at: '2026-10-20T10:00:00.000Z' });
  b.recordInventoryLoss({ product_id: 1, qty_milli: 1000, reason: 'BROKEN', created_at: '2026-10-26T10:00:00.000Z' });
  b.recordInventoryLoss({ product_id: 2, qty_milli: 1000, reason: 'EXPIRED', created_at: '2026-10-26T11:00:00.000Z' });
  assert.equal(b.getInventoryLosses({ reason: 'EXPIRED' }).length, 2);
  assert.equal(b.getInventoryLosses({ product_id: 2 }).length, 1);
  assert.equal(b.getInventoryLosses({ reason: 'EXPIRED', product_id: 1 }).length, 1);
  assert.equal(b.getInventoryLosses({ from: '2026-10-25T00:00:00.000Z' }).length, 2);
  assert.equal(b.getInventoryLosses({ to: '2026-10-21T00:00:00.000Z' }).length, 1);
  assert.throws(() => b.getInventoryLosses({ reason: 'NOPE' as never }), /invalid loss reason/);
  b.close();
});

test('expiry: threshold filter, ASC order, excludes non-perishables', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct({ ...MILK, id: 1, expiry_date: day(3) });
  b.upsertProduct({ ...MILK, id: 2, barcode: 'B', expiry_date: day(10) });
  b.upsertProduct({ ...MILK, id: 3, barcode: 'C', expiry_date: day(-1) });
  b.upsertProduct({ ...MILK, id: 4, barcode: 'D', has_expiry: 0, expiry_date: day(1) });
  b.upsertProduct({ ...MILK, id: 5, barcode: 'E', expiry_date: null });
  const week = b.getExpiringProducts(7).map(p => p.id);
  assert.deepEqual(week, [3, 1]);
  assert.deepEqual(b.getExpiringProducts(0).map(p => p.id), [3]);
  assert.deepEqual(b.getExpiringProducts(30).map(p => p.id), [3, 1, 2]);
  assert.throws(() => b.getExpiringProducts(-1), /non-negative/);
  b.close();
});
