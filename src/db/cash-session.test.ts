import test from 'node:test';
import assert from 'node:assert/strict';
import { openBarakaDb } from './sqlite.js';
import type { SaleHeaderInput, SaleItemInput } from './sqlite.js';

const PROD = {
  id: 20, barcode: '6130000000207', name_fr: 'SUCRE 1KG', name_ar: '',
  category_id: 'epicerie', buy_price_ct: 8000, sell_price_ct: 9000,
  tva_rate: 0 as const, stock_milli: 1000000, min_stock_milli: 0,
  unit: 'PIECE' as const, is_scale: 0, scale_item_code: null,
  has_expiry: 0, expiry_date: null,
};

const item = (ht: number, tva: number, rate: 0 | 9 | 19): SaleItemInput => ({
  product_id: 20, barcode: PROD.barcode, name_fr: PROD.name_fr, name_ar: '',
  unit_price_ct: ht + tva, qty_milli: 1000, unit: 'PIECE', tva_rate: rate,
  discount_bp: 0, line_ht_ct: ht, line_tva_ct: tva, line_ttc_ct: ht + tva,
});

const header = (method: 'ESPECES' | 'CIB', ht: number, tva: number, timbre: number): SaleHeaderInput => {
  const bd = (b: number, a: number) => ({ rate: 0 as const, base_ht_ct: b, tva_amount_ct: a, total_ttc_ct: b + a });
  return {
    cashier_id: 'c1', cashier_name: 'Yacine', payment_method: method,
    amount_paid_ct: ht + tva + timbre, amount_returned_ct: 0,
    totals: {
      total_ht_ct: ht, total_tva_ct: tva, timbre_ct: timbre, total_ttc_ct: ht + tva + timbre,
      tva_breakdown: {
        0: { rate: 0 as const, base_ht_ct: ht, tva_amount_ct: tva, total_ttc_ct: ht + tva },
        9: bd(0, 0), 19: bd(0, 0),
      },
    },
  };
};

const seedClient = (b: ReturnType<typeof openBarakaDb>, id: number, balanceCt: number) => {
  (b as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
    .prepare('INSERT INTO clients (id, name, phone, credit_balance_ct, max_credit_limit_ct) VALUES (?, ?, ?, ?, 0)')
    .run(id, `CLIENT ${id}`, '0550000000', balanceCt);
};

test('cash: open session with 10,000 DZD float; double-open rejected', () => {
  const b = openBarakaDb(':memory:');
  const s = b.openCashSession('Yacine', 1000000);
  assert.equal(s.cashierName, 'Yacine');
  assert.equal(s.openingFloatCt, 1000000);
  assert.equal(s.status, 'OPEN');
  assert.throws(() => b.openCashSession('Karim', 500000), /already OPEN/);
  assert.throws(() => b.openCashSession('  ', 100), /cashierName/);
  assert.throws(() => b.openCashSession('Karim', -5), />= 0/);
  b.close();
});

test('cash: movements adjust live theoretical (deposit +, expense -)', () => {
  const b = openBarakaDb(':memory:');
  const s = b.openCashSession('Yacine', 1000000);
  b.recordCashMovement(s.id, 'DEPOSIT', 200000, 'appoint caisse');
  b.recordCashMovement(s.id, 'EXPENSE', 50000, 'sachets plastique');
  const live = b.getCashSessionStatus(s.id);
  assert.equal(live.openingFloatCt, 1000000);
  assert.equal(live.depositsCt, 200000);
  assert.equal(live.expensesCt, 50000);
  assert.equal(live.theoreticalCashCt, 1150000);
  assert.throws(() => b.recordCashMovement('nope', 'DEPOSIT', 100, 'x'), /not found/);
  assert.throws(() => b.recordCashMovement(s.id, 'BONUS' as never, 100, 'x'), /DEPOSIT\|WITHDRAWAL/);
  assert.throws(() => b.recordCashMovement(s.id, 'DEPOSIT', 0, 'x'), /> 0/);
  assert.throws(() => b.recordCashMovement(s.id, 'DEPOSIT', 100, '  '), /reason/);
  b.close();
});

test('cash: full shift aggregates sales, settlement, movements, 500 DZD deficit', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  seedClient(b, 30, 500000);
  const s = b.openCashSession('Yacine', 1000000);
  b.recordSale(header('ESPECES', 300000, 0, 3000), [item(300000, 0, 0)]);
  b.recordSale(header('CIB', 500000, 0, 0), [item(500000, 0, 0)]);
  b.settleClientCredit({ clientId: 30, amountCt: 100000 });
  b.recordCashMovement(s.id, 'DEPOSIT', 50000, 'appoint');
  b.recordCashMovement(s.id, 'WITHDRAWAL', 20000, 'fournisseur oeufs');
  b.recordCashMovement(s.id, 'EXPENSE', 10000, 'nettoyage');
  const live = b.getCashSessionStatus(s.id);
  assert.equal(live.cashSalesCt, 303000);
  assert.equal(live.settlementsCashCt, 101000);
  assert.equal(live.totalSalesCount, 2);
  assert.equal(live.theoreticalCashCt, 1424000);
  const z = b.closeCashSessionAndGenerateZ(s.id, 1419000, 'cloture soir');
  assert.match(z.zNumber, /^Z-\d{4}-\d{6}$/);
  assert.equal(z.salesCount, 2);
  assert.equal(z.totalHtCt, 800000);
  assert.equal(z.totalTtcCt, 803000);
  assert.equal(z.totalTimbreCt, 3000);
  assert.equal(z.cashSalesCt, 303000);
  assert.equal(z.cashDiffCt, -5000);
  assert.equal(z.closingCountedCt, 1419000);
  assert.equal(z.theoreticalCashCt, 1424000);
  assert.ok(z.hash.length >= 32);
  const st = b.getCashSessionStatus(s.id);
  assert.equal(st.session.status, 'CLOSED');
  assert.equal(st.session.zReportId, z.zNumber);
  assert.equal(st.session.cashDiffCt, -5000);
  b.close();
});

test('cash: Z numbers monotonic and hash-chained across shifts', () => {
  const b = openBarakaDb(':memory:');
  const a = b.openCashSession('Yacine', 100000);
  const za = b.closeCashSessionAndGenerateZ(a.id, 100000);
  const c = b.openCashSession('Karim', 100000);
  const zc = b.closeCashSessionAndGenerateZ(c.id, 100000);
  assert.ok(zc.zNumber > za.zNumber);
  assert.equal(zc.prevHash, za.hash);
  assert.equal(b.listZReports().length, 2);
  b.close();
});

test('cash: double close, unknown session and negative count rejected', () => {
  const b = openBarakaDb(':memory:');
  const s = b.openCashSession('Yacine', 100000);
  b.closeCashSessionAndGenerateZ(s.id, 100000);
  assert.throws(() => b.closeCashSessionAndGenerateZ(s.id, 100000), /already CLOSED/);
  assert.throws(() => b.closeCashSessionAndGenerateZ('ghost', 100), /not found/);
  assert.throws(() => b.recordCashMovement(s.id, 'DEPOSIT', 100, 'late'), /is CLOSED/);
  const s2 = b.openCashSession('Karim', 0);
  assert.throws(() => b.closeCashSessionAndGenerateZ(s2.id, -1), />= 0/);
  b.close();
});

test('cash: active session lookup returns null when none open', () => {
  const b = openBarakaDb(':memory:');
  assert.equal(b.getActiveCashSession(), null);
  const s = b.openCashSession('Yacine', 70000);
  const live = b.getActiveCashSession();
  assert.ok(live);
  assert.equal(live.session.id, s.id);
  assert.equal(live.theoreticalCashCt, 70000);
  b.closeCashSessionAndGenerateZ(s.id, 70000);
  assert.equal(b.getActiveCashSession(), null);
  b.close();
});

test('cash: TVA 9/19 aggregates land in the Z snapshot', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct({ ...PROD, id: 21, barcode: '6130000000214', tva_rate: 9 });
  const nine: SaleItemInput = {
    product_id: 21, barcode: '6130000000214', name_fr: 'X', name_ar: '',
    unit_price_ct: 109000, qty_milli: 1000, unit: 'PIECE', tva_rate: 9,
    discount_bp: 0, line_ht_ct: 100000, line_tva_ct: 9000, line_ttc_ct: 109000,
  };
  const h = header('CIB', 100000, 9000, 0);
  h.totals.tva_breakdown[9] = { rate: 9, base_ht_ct: 100000, tva_amount_ct: 9000, total_ttc_ct: 109000 };
  h.totals.tva_breakdown[0] = { rate: 0, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 };
  const s = b.openCashSession('Yacine', 50000);
  b.recordSale(h, [nine]);
  // TVA-9 CIB sale recorded inside the window lands in the Z snapshot.
  const z = b.closeCashSessionAndGenerateZ(s.id, 159000);
  assert.equal(z.salesCount, 1);
  assert.equal(z.totalHtCt, 100000);
  assert.equal(z.totalTva9Ct, 9000);
  assert.equal(z.totalTva19Ct, 0);
  assert.equal(z.totalTtcCt, 109000);
  assert.equal(z.cibSalesCt, 109000);
  assert.equal(z.cashSalesCt, 0);
  assert.equal(z.theoreticalCashCt, 50000);
  assert.equal(z.cashDiffCt, 109000);
  b.close();
});
