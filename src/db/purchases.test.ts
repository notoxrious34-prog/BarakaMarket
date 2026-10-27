import test from 'node:test';
import assert from 'node:assert/strict';
import { openBarakaDb } from './sqlite.js';

const WATER = {
  id: 10, barcode: '6130000000109', name_fr: 'EAU MINERALE', name_ar: '',
  category_id: 'boissons', buy_price_ct: 3000, sell_price_ct: 4500,
  tva_rate: 0 as const, stock_milli: 12000, min_stock_milli: 0,
  unit: 'PIECE' as const, is_scale: 0, scale_item_code: null,
  has_expiry: 0, expiry_date: null,
};

const seedSupplier = (b: ReturnType<typeof openBarakaDb>, id = 1, name = 'SARL EAU PLUS') => {
  (b as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
    .prepare('INSERT INTO suppliers (id, name) VALUES (?, ?)').run(id, name);
};

const tableCount = (b: ReturnType<typeof openBarakaDb>, table: string): number =>
  ((b as unknown as { db: { prepare: (s: string) => { get: () => { n: number } } } }).db
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);

test('purchases: 10 cartons x6 influx 60000 milli + cost update', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  const out = b.receiveSupplierDelivery({
    supplierId: 1, invoiceRef: 'BL-2026-0842',
    items: [{ productId: 10, packMultiplier: 6, packCount: 10, unitCostCt: 3000 }],
    paidAmountCt: 0,
  });
  assert.equal(out.itemsProcessed, 1);
  assert.equal(out.totalCostCt, 180000);
  assert.equal(out.remainingDebtCt, 180000);
  assert.equal(typeof out.purchaseId, 'string');
  const prod = b.getProduct(10);
  assert.equal(prod.stock_milli, 72000);
  assert.equal(prod.buy_price_ct, 3000);
  const row = (b as unknown as { db: { prepare: (s: string) => { get: () => Record<string, unknown> } } }).db
    .prepare('SELECT * FROM purchase_items').get();
  assert.equal(row.qty_milli, 60000);
  assert.equal(row.unit_buy_price_ht_ct, 3000);
  assert.equal(row.tva_rate, 0);
  const pur = (b as unknown as { db: { prepare: (s: string) => { get: () => Record<string, unknown> } } }).db
    .prepare('SELECT * FROM purchases').get();
  assert.equal(pur.invoice_number, 'BL-2026-0842');
  assert.equal(pur.total_ttc_ct, 180000);
  assert.equal(pur.amount_due_ct, 180000);
  b.close();
});

test('purchases: updateSellPriceCt refreshes sell; absent keeps old', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  b.upsertProduct({ ...WATER, id: 11, barcode: '6130000000116' });
  b.receiveSupplierDelivery({
    supplierId: 1,
    items: [
      { productId: 10, packCount: 1, unitCostCt: 3200, updateSellPriceCt: 5000 },
      { productId: 11, packCount: 1, unitCostCt: 3200 },
    ],
    paidAmountCt: 6400,
  });
  assert.equal(b.getProduct(10).sell_price_ct, 5000);
  assert.equal(b.getProduct(11).sell_price_ct, 4500);
  assert.equal(b.getProduct(11).buy_price_ct, 3200);
  b.close();
});

test('purchases: partial 50,000/20,000 DZD -> balance exactly 3,000,000ct', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct({ ...WATER, id: 12, barcode: '6130000000123' });
  const out = b.receiveSupplierDelivery({
    supplierId: 1, invoiceRef: 'BL-PART',
    items: [{ productId: 12, packCount: 100, unitCostCt: 50000 }],
    paidAmountCt: 2000000, paymentMethod: 'VIREMENT',
  });
  assert.equal(out.totalCostCt, 5000000);
  assert.equal(out.remainingDebtCt, 3000000);
  const sup = (b as unknown as { db: { prepare: (s: string) => { get: (id: number) => Record<string, unknown> } } }).db
    .prepare('SELECT * FROM suppliers WHERE id = ?').get(1);
  assert.equal(sup.balance_due_ct, 3000000);
  const pay = (b as unknown as { db: { prepare: (s: string) => { get: () => Record<string, unknown> } } }).db
    .prepare('SELECT * FROM supplier_payments').get();
  assert.equal(pay.amount_ct, 2000000);
  assert.equal(pay.payment_method, 'VIREMENT');
  assert.equal(pay.reference, 'BL-PART');
  b.close();
});

test('purchases: full payment -> balance 0, method stored on purchase', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  const out = b.receiveSupplierDelivery({
    supplierId: 1,
    items: [{ productId: 10, packCount: 5, unitCostCt: 3000 }],
    paidAmountCt: 15000,
  });
  assert.equal(out.remainingDebtCt, 0);
  const sup = (b as unknown as { db: { prepare: (s: string) => { get: (id: number) => Record<string, unknown> } } }).db
    .prepare('SELECT * FROM suppliers WHERE id = ?').get(1);
  assert.equal(sup.balance_due_ct, 0);
  const pur = (b as unknown as { db: { prepare: (s: string) => { get: () => Record<string, unknown> } } }).db
    .prepare('SELECT * FROM purchases').get();
  assert.equal(pur.payment_method, 'ESPECES');
  b.close();
});

test('purchases: zero payment -> no payment row, full debt', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  b.receiveSupplierDelivery({
    supplierId: 1, items: [{ productId: 10, packCount: 2, unitCostCt: 3000 }], paidAmountCt: 0,
  });
  assert.equal(tableCount(b, 'supplier_payments'), 0);
  const sup = (b as unknown as { db: { prepare: (s: string) => { get: (id: number) => Record<string, unknown> } } }).db
    .prepare('SELECT * FROM suppliers WHERE id = ?').get(1);
  assert.equal(sup.balance_due_ct, 6000);
  b.close();
});

test('purchases: overpayment throws and persists nothing', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  assert.throws(() => b.receiveSupplierDelivery({
    supplierId: 1, items: [{ productId: 10, packCount: 1, unitCostCt: 3000 }], paidAmountCt: 3001,
  }), /exceeds delivery total/);
  assert.equal(tableCount(b, 'purchases'), 0);
  assert.equal(tableCount(b, 'purchase_items'), 0);
  assert.equal(tableCount(b, 'supplier_payments'), 0);
  assert.equal(b.getProduct(10).stock_milli, 12000);
  b.close();
});

test('purchases: invalid product rolls back the whole batch', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  assert.throws(() => b.receiveSupplierDelivery({
    supplierId: 1,
    items: [
      { productId: 10, packCount: 4, unitCostCt: 3000 },
      { productId: 999, packCount: 1, unitCostCt: 100 },
    ],
    paidAmountCt: 5000,
  }), /delivery product not found: 999/);
  assert.equal(b.getProduct(10).stock_milli, 12000);
  assert.equal(tableCount(b, 'purchases'), 0);
  assert.equal(tableCount(b, 'purchase_items'), 0);
  assert.equal(tableCount(b, 'supplier_payments'), 0);
  const sup = (b as unknown as { db: { prepare: (s: string) => { get: (id: number) => Record<string, unknown> } } }).db
    .prepare('SELECT * FROM suppliers WHERE id = ?').get(1);
  assert.equal(sup.balance_due_ct, 0);
  b.close();
});

test('purchases: unknown supplier rolls back with zero side effects', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(WATER);
  assert.throws(() => b.receiveSupplierDelivery({
    supplierId: 77, items: [{ productId: 10, packCount: 1, unitCostCt: 3000 }], paidAmountCt: 0,
  }), /supplier not found: 77/);
  assert.equal(tableCount(b, 'purchases'), 0);
  assert.equal(b.getProduct(10).stock_milli, 12000);
  b.close();
});

test('purchases: empty items and bad quantities rejected', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  assert.throws(() => b.receiveSupplierDelivery({ supplierId: 1, items: [], paidAmountCt: 0 }), /at least one item/);
  assert.throws(() => b.receiveSupplierDelivery({
    supplierId: 1, items: [{ productId: 10, packCount: 2, packMultiplier: 0, unitCostCt: 3000 }], paidAmountCt: 0,
  }), /packMultiplier/);
  assert.throws(() => b.receiveSupplierDelivery({
    supplierId: 1, items: [{ productId: 10, packCount: 0, unitCostCt: 3000 }], paidAmountCt: 0,
  }), /packCount/);
  assert.equal(tableCount(b, 'purchases'), 0);
  b.close();
});

test('purchases: totalCostCt mismatch and bad TVA rejected', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  assert.throws(() => b.receiveSupplierDelivery({
    supplierId: 1,
    items: [{ productId: 10, packCount: 2, unitCostCt: 3000, totalCostCt: 6100 }],
    paidAmountCt: 0,
  }), /totalCostCt/);
  assert.throws(() => b.receiveSupplierDelivery({
    supplierId: 1,
    items: [{ productId: 10, packCount: 1, unitCostCt: 3000, tvaRate: 7 as never }],
    paidAmountCt: 0,
  }), /TVA rate/);
  b.close();
});

test('purchases: TVA 9 line rounds half-up (1111 HT -> 100 TVA)', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct({ ...WATER, id: 13, barcode: '6130000000130', tva_rate: 9 });
  const out = b.receiveSupplierDelivery({
    supplierId: 1, items: [{ productId: 13, packCount: 1, unitCostCt: 1111 }], paidAmountCt: 0,
  });
  assert.equal(out.totalCostCt, 1211);
  const row = (b as unknown as { db: { prepare: (s: string) => { get: () => Record<string, unknown> } } }).db
    .prepare('SELECT * FROM purchase_items').get();
  assert.equal(row.line_ht_ct, 1111);
  assert.equal(row.line_ttc_ct, 1211);
  assert.equal(row.tva_rate, 9);
  b.close();
});

test('purchases: getSupplierPurchases newest-first with limit', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  const recv = (ref: string, date: string) => b.receiveSupplierDelivery({
    supplierId: 1, invoiceRef: ref, date,
    items: [{ productId: 10, packCount: 1, unitCostCt: 1000 }], paidAmountCt: 0,
  });
  recv('BL-1', '2026-10-20T10:00:00.000Z');
  recv('BL-2', '2026-10-21T10:00:00.000Z');
  recv('BL-3', '2026-10-22T10:00:00.000Z');
  const all = b.getSupplierPurchases(1).map(r => r.invoice_number);
  assert.deepEqual(all, ['BL-3', 'BL-2', 'BL-1']);
  assert.equal(b.getSupplierPurchases(1, 2).length, 2);
  assert.throws(() => b.getSupplierPurchases(1, 0), /limit/);
  b.close();
});

test('purchases: statement aggregates purchased, paid and outstanding', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b);
  b.upsertProduct(WATER);
  b.receiveSupplierDelivery({
    supplierId: 1, items: [{ productId: 10, packCount: 10, unitCostCt: 1000 }], paidAmountCt: 4000,
  });
  b.receiveSupplierDelivery({
    supplierId: 1, items: [{ productId: 10, packCount: 5, unitCostCt: 1000 }], paidAmountCt: 5000,
  });
  const st = b.getSupplierBalanceStatement(1);
  assert.equal(st.supplierId, 1);
  assert.equal(st.supplierName, 'SARL EAU PLUS');
  assert.equal(st.totalPurchasedCt, 15000);
  assert.equal(st.totalPaidCt, 9000);
  assert.equal(st.outstandingCt, 6000);
  assert.throws(() => b.getSupplierBalanceStatement(77), /supplier not found/);
  b.close();
});

test('purchases: second supplier ledger stays isolated', () => {
  const b = openBarakaDb(':memory:');
  seedSupplier(b, 1, 'SUP A');
  seedSupplier(b, 2, 'SUP B');
  b.upsertProduct(WATER);
  b.receiveSupplierDelivery({
    supplierId: 2, items: [{ productId: 10, packCount: 3, unitCostCt: 1000 }], paidAmountCt: 0,
  });
  assert.equal(b.getSupplierBalanceStatement(1).outstandingCt, 0);
  assert.equal(b.getSupplierBalanceStatement(2).outstandingCt, 3000);
  assert.equal(b.getSupplierPurchases(1).length, 0);
  b.close();
});
