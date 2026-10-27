import test from 'node:test';
import assert from 'node:assert/strict';
import { openBarakaDb } from './sqlite.js';

test('void: default PIN 1234 passes, wrong PIN fails', () => {
  const b = openBarakaDb(':memory:');
  assert.equal(b.verifyManagerPinDb('1234'), true);
  assert.equal(b.verifyManagerPinDb('0000'), false);
  assert.equal(b.verifyManagerPinDb(''), false);
  b.close();
});

test('void: PIN rotation retires the old code', () => {
  const b = openBarakaDb(':memory:');
  b.setManagerPin('9876');
  assert.equal(b.verifyManagerPinDb('1234'), false);
  assert.equal(b.verifyManagerPinDb('9876'), true);
  assert.throws(() => b.setManagerPin('12'), /4-8 numeric/);
  assert.throws(() => b.setManagerPin('abcd'), /4-8 numeric/);
  assert.equal(b.verifyManagerPinDb('9876'), true);
  b.close();
});

test('void: line void stores exact centimes with manager attribution', () => {
  const b = openBarakaDb(':memory:');
  const r = b.recordVoidLog({
    actionType: 'LINE_VOID', productId: 20, productName: 'SUCRE 1KG',
    amountCt: 145000, cashierName: 'Yacine', managerApprovedBy: 'Hadj',
    reason: 'client desiste', sessionId: 'sess-1',
  });
  assert.equal(r.amountCt, 145000);
  assert.equal(r.managerApprovedBy, 'Hadj');
  assert.equal(r.sessionId, 'sess-1');
  assert.ok(r.id.length > 0 && r.createdAt.length > 0);
  b.close();
});

test('void: cart clear logs the abandoned total', () => {
  const b = openBarakaDb(':memory:');
  const r = b.recordVoidLog({
    actionType: 'CART_CLEAR', amountCt: 87300, cashierName: 'Karim', reason: 'panne tiroir',
  });
  assert.equal(r.actionType, 'CART_CLEAR');
  assert.equal(r.productId, undefined);
  const logs = b.getVoidLogs();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].amountCt, 87300);
  b.close();
});

test('void: summary aggregates count and centimes, per session', () => {
  const b = openBarakaDb(':memory:');
  b.recordVoidLog({ actionType: 'LINE_VOID', amountCt: 145000, cashierName: 'Y', reason: 'a', sessionId: 's1' });
  b.recordVoidLog({ actionType: 'MANUAL_DISCOUNT', amountCt: 5000, cashierName: 'Y', reason: 'b', sessionId: 's1' });
  b.recordVoidLog({ actionType: 'DRAWER_KICK', amountCt: 0, cashierName: 'K', reason: 'c', sessionId: 's2' });
  assert.deepEqual(b.getVoidSummaryBySession(), { totalVoidCount: 3, totalVoidAmountCt: 150000 });
  assert.deepEqual(b.getVoidSummaryBySession('s1'), { totalVoidCount: 2, totalVoidAmountCt: 150000 });
  assert.deepEqual(b.getVoidSummaryBySession('s9'), { totalVoidCount: 0, totalVoidAmountCt: 0 });
  b.close();
});

test('void: newest-first order with limit and reason filters', () => {
  const b = openBarakaDb(':memory:');
  b.recordVoidLog({ actionType: 'LINE_VOID', amountCt: 100, cashierName: 'Y', reason: 'r1' });
  b.recordVoidLog({ actionType: 'LINE_VOID', amountCt: 200, cashierName: 'Y', reason: 'r2' });
  const all = b.getVoidLogs();
  assert.equal(all[0].amountCt, 200);
  assert.equal(b.getVoidLogs({ limit: 1 }).length, 1);
  assert.equal(b.getVoidLogs({ reason: 'r1' }).length, 1);
  assert.equal(b.getVoidLogs({ reason: 'r1' })[0].amountCt, 100);
  assert.throws(() => b.getVoidLogs({ limit: 0 }), /> 0/);
  b.close();
});

test('void: append-only journal keeps every record with monotonic ids', () => {
  const b = openBarakaDb(':memory:');
  const a = b.recordVoidLog({ actionType: 'DRAWER_KICK', amountCt: 0, cashierName: 'Y', reason: 'test tiroir' });
  const c = b.recordVoidLog({ actionType: 'DRAWER_KICK', amountCt: 0, cashierName: 'Y', reason: 'test tiroir' });
  assert.ok(Number(c.id) > Number(a.id));
  assert.equal(b.getVoidLogs().length, 2);
  b.close();
});

test('void: guards reject bad actions, amounts and empty audit fields', () => {
  const b = openBarakaDb(':memory:');
  assert.throws(() => b.recordVoidLog({
    actionType: 'HACK' as never, amountCt: 100, cashierName: 'Y', reason: 'x',
  }), /LINE_VOID\|CART_CLEAR/);
  assert.throws(() => b.recordVoidLog({
    actionType: 'LINE_VOID', amountCt: -5, cashierName: 'Y', reason: 'x',
  }), />= 0/);
  assert.throws(() => b.recordVoidLog({
    actionType: 'LINE_VOID', amountCt: 5, cashierName: '  ', reason: 'x',
  }), /cashierName/);
  assert.throws(() => b.recordVoidLog({
    actionType: 'LINE_VOID', amountCt: 5, cashierName: 'Y', reason: ' ',
  }), /reason/);
  assert.equal(b.getVoidSummaryBySession().totalVoidCount, 0);
  b.close();
});

test('void: legacy sale-void flow coexists with override audit rows', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct({
    id: 20, barcode: '6130000000207', name_fr: 'SUCRE', name_ar: '', category_id: 'epicerie',
    buy_price_ct: 8000, sell_price_ct: 9000, tva_rate: 0, stock_milli: 1000000,
    min_stock_milli: 0, unit: 'PIECE', is_scale: 0, scale_item_code: null, has_expiry: 0, expiry_date: null,
  });
  const sale = b.recordSale({
    cashier_id: 'c1', cashier_name: 'Y', payment_method: 'ESPECES',
    amount_paid_ct: 10000, amount_returned_ct: 0,
    totals: {
      total_ht_ct: 9000, total_tva_ct: 0, timbre_ct: 1000, total_ttc_ct: 10000,
      tva_breakdown: {
        0: { rate: 0, base_ht_ct: 9000, tva_amount_ct: 0, total_ttc_ct: 9000 },
        9: { rate: 9, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
        19: { rate: 19, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
      },
    },
  }, [{
    product_id: 20, barcode: '6130000000207', name_fr: 'SUCRE', name_ar: '',
    unit_price_ct: 9000, qty_milli: 1000, unit: 'PIECE', tva_rate: 0,
    discount_bp: 0, line_ht_ct: 9000, line_tva_ct: 0, line_ttc_ct: 9000,
  }]);
  b.voidSale(sale.id, 'billet faux', 'Hadj');
  b.recordVoidLog({ actionType: 'LINE_VOID', amountCt: 100, cashierName: 'Y', reason: 'desiste' });
  // Legacy sale voids carry no action_type; override queries exclude them.
  assert.equal(b.getVoidLogs().length, 1);
  assert.equal(b.getVoidSummaryBySession().totalVoidCount, 1);
  b.close();
});
