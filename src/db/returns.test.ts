import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb, computeDayAggregates } from './sqlite.js';
import { fiscalDayISO } from '../core/fiscal-day.js';
import { calculateLineTotalsCt, calculateSaleTotalsCt } from '../core/fiscal.centimes.js';

// NOTE: C: is 100% full on this machine -> test DBs live under repo data/.tmp-tests (D:).
const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
let n = 0;
const tmpFile = (tag: string) => {
  n += 1;
  const p = path.join(TMP, `returns-${tag}-${process.pid}-${n}.db`);
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* fresh */ }
  }
  return p;
};

const PROD = {
  id: 1, barcode: '6130000000014', name_fr: 'LAIT CONDENSE', name_ar: 'حليب',
  category_id: 'laiterie', buy_price_ct: 14500, sell_price_ct: 18000,
  tva_rate: 9 as const, stock_milli: 48000, min_stock_milli: 10000,
  unit: 'PIECE' as const, is_scale: 0, scale_item_code: null,
  has_expiry: 1, expiry_date: '2026-12-15',
};

// Engine-computed vectors (timbre/regime always agree with recordSale's gate).
function vectors(method: 'ESPECES' | 'CIB' | 'CREDIT' = 'ESPECES') {
  const a = calculateLineTotalsCt(18000, 2, 9);
  const c = calculateLineTotalsCt(12000, 3, 19);
  const items = [
    { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE' as const, tva_rate: 9 as const, discount_bp: 0, line_ht_ct: a.total_line_ht_ct, line_tva_ct: a.total_line_tva_ct, line_ttc_ct: a.total_line_ttc_ct },
    { product_id: 1, barcode: 'c', name_fr: 'CHOC', name_ar: '', unit_price_ct: 12000, qty_milli: 3000, unit: 'PIECE' as const, tva_rate: 19 as const, discount_bp: 0, line_ht_ct: c.total_line_ht_ct, line_tva_ct: c.total_line_tva_ct, line_ttc_ct: c.total_line_ttc_ct },
  ];
  const totals = calculateSaleTotalsCt(
    [{ tva_rate: 9 as const, ...a }, { tva_rate: 19 as const, ...c }], method,
  );
  return { items, totals };
}

function recordTodaySale(b: ReturnType<typeof openBarakaDb>, method: 'ESPECES' | 'CIB' | 'CREDIT' = 'ESPECES', clientId?: number) {
  const v = vectors(method);
  return b.recordSale(
    {
      cashier_id: 'C-1', cashier_name: 'Amine', payment_method: method,
      amount_paid_ct: (v.totals as { total_ttc_ct: number }).total_ttc_ct,
      amount_returned_ct: 0, totals: v.totals as never,
      client_id: clientId ?? null, created_at: new Date().toISOString(),
    },
    v.items,
  );
}

function saleItemIds(b: ReturnType<typeof openBarakaDb>, saleId: string): number[] {
  return (b.db.prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC').all(saleId) as { id: number }[]).map(r => r.id);
}

test('v1.5.0: full-line ESPECES return — stock back, WITHDRAWAL, RET number, audit', () => {
  const p = tmpFile('happy');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    b.openCashSession('Amine', 1000000);
    const sale = recordTodaySale(b);
    assert.equal(b.getProduct(1).stock_milli, 48000 - 5000);
    const [la] = saleItemIds(b, sale.id);
    const d = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 2000 }], reason: 'DEFECT', actor: 'lina' });
    assert.equal(d.refund_ct, 36000);
    const head0 = b.getReturnOrNull(d.id) as Record<string, unknown>;
    assert.equal(head0.status, 'DRAFT');
    assert.equal(head0.return_number, null);
    const ap = b.approveReturn(d.id, 'karim', 'manager');
    assert.match(ap.return_number, /^RET-\d{4}-\d{6}$/);
    assert.equal(ap.refund_ct, 36000);
    // A1: DEFECT defaults to QUARANTINE — held for the rep, nothing restocks.
    assert.equal(b.getProduct(1).stock_milli, 48000 - 5000);
    const head1 = b.getReturnOrNull(d.id) as Record<string, unknown>;
    const itemDisp = (head1.items as Record<string, unknown>[])[0].disposition;
    assert.equal(itemDisp, 'QUARANTINE');
    const moves = b.listCashMovements(b.getActiveCashSession()!.session.id);
    const w = moves.find(m => m.type === 'WITHDRAWAL');
    assert.ok(w, 'a WITHDRAWAL movement carries the refund');
    assert.equal(w.amountCt, 36000);
    const audit = b.listAudit(50).map(a => (a as { action: string }).action);
    assert.ok(audit.includes('return.create') && audit.includes('return.approve'));
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('v1.5.0: partial KG return prorates half-up with derived TVA (no 1ct drift)', () => {
  const p = tmpFile('prorata');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct({ ...PROD, unit: 'KG' as const });
    const sale = b.recordSale(
      {
        cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
        amount_paid_ct: 37000, amount_returned_ct: 0,
        totals: {
          total_ht_ct: 33028, total_tva_ct: 2972, timbre_ct: 1000, total_ttc_ct: 37000,
          tva_breakdown: {
            0: { base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
            9: { base_ht_ct: 33028, tva_amount_ct: 2972, total_ttc_ct: 36000 },
            19: { base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
          },
        } as never, created_at: new Date().toISOString(),
      },
      [{ product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'KG', tva_rate: 9 as const, discount_bp: 0, line_ht_ct: 33028, line_tva_ct: 2972, line_ttc_ct: 36000 }],
    );
    const [la] = saleItemIds(b, sale.id);
    // return exactly half: 1000/2000
    const d = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 1000 }], reason: 'EXPIRED', actor: 'lina' });
    assert.equal(d.refund_ct, 18000);
    const got = b.getReturnOrNull(d.id) as unknown as { items: { line_ht_ct: number; line_tva_ct: number; line_ttc_ct: number }[] };
    assert.equal(got.items[0].line_ht_ct, 16514);
    assert.equal(got.items[0].line_ttc_ct, 18000);
    assert.equal(got.items[0].line_tva_ct, 18000 - 16514); // derived, invariant holds
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('v1.5.0: guards — unknown/cancelled sale, bad reason, over-qty, double decision', () => {
  const p = tmpFile('guards');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    b.openCashSession('Amine', 1000000);
    const sale = recordTodaySale(b);
    const [la, lc] = saleItemIds(b, sale.id);
    assert.throws(() => b.createReturnDraft({ sale_id: 'nope', lines: [{ saleItemId: la, qty_milli: 1 }], reason: 'DEFECT', actor: 'lina' }), /sale not found/);
    assert.throws(() => b.createReturnDraft({ sale_id: sale.id, lines: [], reason: 'DEFECT', actor: 'lina' }), /at least one line/);
    assert.throws(() => b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: 999999, qty_milli: 1 }], reason: 'DEFECT', actor: 'lina' }), /not part of/);
    assert.throws(() => b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 2001 }], reason: 'DEFECT', actor: 'lina' }), /exceeds remaining/);
    assert.throws(() => b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 1 }], reason: 'NOPE' as never, actor: 'lina' }), /bad return reason/);
    // A4 (supermarket): OTHER without a note is refused, with a note passes.
    assert.throws(() => b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 1 }], reason: 'OTHER', actor: 'lina' }), /needs a note/);
    assert.throws(() => b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 1 }], reason: 'OTHER', reason_note: '   ', actor: 'lina' }), /needs a note/);
    const noted = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 1 }], reason: 'OTHER', reason_note: 'boîte écrasée', actor: 'lina' });
    assert.equal(typeof noted.id, 'string');
    b.voidSale(sale.id, 'test', 'karim');
    assert.throws(() => b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: lc, qty_milli: 1 }], reason: 'DEFECT', actor: 'lina' }), /COMPLETED/);
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('A2 (supermarket): ESPECES approve refuses when the drawer cannot cover the refund', () => {
  const p = tmpFile('drawer-short');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    b.openCashSession('Amine', 0);
    const sale = recordTodaySale(b);
    const [la] = saleItemIds(b, sale.id);
    const d = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 2000 }], reason: 'DEFECT', actor: 'lina' });
    const live = b.getActiveCashSession()!;
    // Drain every centime that came in — the drawer is now empty.
    b.recordCashMovement(live.session.id, 'WITHDRAWAL', live.theoreticalCashCt, 'supplier run');
    assert.throws(() => b.approveReturn(d.id, 'karim', 'manager'), /drawer short/);
    // Top up exactly the refund → approval passes and the drawer nets to zero.
    b.recordCashMovement(live.session.id, 'DEPOSIT', d.refund_ct, 'top-up');
    const ap = b.approveReturn(d.id, 'karim', 'manager');
    assert.match(ap.return_number, /^RET-\d{4}-\d{6}$/);
    assert.equal(b.getActiveCashSession()!.theoreticalCashCt, 0);
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('v1.5.0: 7-day window — day 7 passes, day 8 refused', () => {
  const p = tmpFile('window');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    const mk = (daysAgo: number) => {
      const v = vectors('ESPECES');
      const line = v.items[0];
      const singleTotals = calculateSaleTotalsCt(
        [{ tva_rate: 9 as const, total_line_ht_ct: line.line_ht_ct, total_line_tva_ct: line.line_tva_ct, total_line_ttc_ct: line.line_ttc_ct }],
        'ESPECES',
      );
      return b.recordSale(
        {
          cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
          amount_paid_ct: (singleTotals as { total_ttc_ct: number }).total_ttc_ct,
          amount_returned_ct: 0, totals: singleTotals as never,
          created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
        },
        [line],
      );
    };
    const ok = mk(7);
    const [la] = saleItemIds(b, ok.id);
    const d = b.createReturnDraft({ sale_id: ok.id, lines: [{ saleItemId: la, qty_milli: 2000 }], reason: 'DEFECT', actor: 'lina' });
    assert.equal(d.refund_ct, 36000);
    const old = mk(8);
    const [lb] = saleItemIds(b, old.id);
    assert.throws(() => b.createReturnDraft({ sale_id: old.id, lines: [{ saleItemId: lb, qty_milli: 2000 }], reason: 'DEFECT', actor: 'lina' }), /return window is 7 days/);
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('v1.5.0: two-person rule + role gate + idempotent draft', () => {
  const p = tmpFile('twoperson');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct({ ...PROD, stock_milli: 1000000 });
    b.openCashSession('Amine', 100000000);
    // big sale: 20x unit @59500, 19% => ttc 1190000 (refund > 500000 threshold)
    const big = b.recordSale(
      {
        cashier_id: 'C-1', cashier_name: 'lina', payment_method: 'ESPECES',
        amount_paid_ct: 1201900, amount_returned_ct: 0, totals: {
          total_ht_ct: 1000000, total_tva_ct: 190000, timbre_ct: 11900, total_ttc_ct: 1201900,
          tva_breakdown: {
            0: { base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
            9: { base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
            19: { base_ht_ct: 1000000, tva_amount_ct: 190000, total_ttc_ct: 1190000 },
          },
        } as never, created_at: new Date().toISOString(),
      },
      [{ product_id: 1, barcode: 'c', name_fr: 'CHOC', name_ar: '', unit_price_ct: 59500, qty_milli: 20000, unit: 'PIECE', tva_rate: 19 as const, discount_bp: 0, line_ht_ct: 1000000, line_tva_ct: 190000, line_ttc_ct: 1190000 }],
    );
    const [lc] = saleItemIds(b, big.id);
    const d = b.createReturnDraft({ sale_id: big.id, lines: [{ saleItemId: lc, qty_milli: 20000 }], reason: 'DEFECT', actor: 'lina', client_return_key: 'k-1' });
    // idempotent retry returns the same draft, no second row
    const d2 = b.createReturnDraft({ sale_id: big.id, lines: [{ saleItemId: lc, qty_milli: 20000 }], reason: 'DEFECT', actor: 'lina', client_return_key: 'k-1' });
    assert.equal(d2.id, d.id);
    assert.equal((b.listReturns('DRAFT') as unknown[]).length, 1);
    // cashier cannot approve at all
    assert.throws(() => b.approveReturn(d.id, 'lina', 'cashier'), /manager or owner/);
    // creator cannot self-approve above 5000 DZD
    assert.throws(() => b.approveReturn(d.id, 'lina', 'manager'), /second person/);
    // a second person can
    const ap = b.approveReturn(d.id, 'karim', 'manager');
    assert.match(ap.return_number, /^RET-/);
    // decided returns are terminal
    assert.throws(() => b.approveReturn(d.id, 'karim', 'owner'), /already decided/);
    assert.throws(() => b.rejectReturn(d.id, 'karim'), /already decided/);
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('v1.5.0: cash needs an open session; card returns need none; reject flow', () => {
  const p = tmpFile('session');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    // no session open: cash draft ok, approval refused
    const sale = recordTodaySale(b, 'ESPECES');
    const [la] = saleItemIds(b, sale.id);
    const d = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 2000 }], reason: 'WRONG_ITEM', actor: 'lina' });
    assert.throws(() => b.approveReturn(d.id, 'karim', 'owner'), /OPEN cash session/);
    // card sale: approval without any session
    const csale = recordTodaySale(b, 'CIB');
    const [ca] = saleItemIds(b, csale.id);
    const cd = b.createReturnDraft({ sale_id: csale.id, lines: [{ saleItemId: ca, qty_milli: 2000 }], reason: 'CHANGED_MIND', actor: 'lina' });
    const ap = b.approveReturn(cd.id, 'karim', 'owner');
    assert.match(ap.return_number, /^RET-/);
    // reject the cash one
    b.rejectReturn(d.id, 'karim', 'client kept it');
    assert.equal((b.getReturnOrNull(d.id) as { status: string }).status, 'REJECTED');
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('v1.5.0: day aggregates net approved returns; Z cross-check holds the net', () => {
  const p = tmpFile('znet');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    b.openCashSession('Amine', 1000000);
    const sale = recordTodaySale(b, 'ESPECES');
    const [la] = saleItemIds(b, sale.id);
    const d = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 2000 }], reason: 'DEFECT', actor: 'lina' });
    b.approveReturn(d.id, 'karim', 'manager');
    const day = fiscalDayISO(new Date());
    const ledger = computeDayAggregates(b.db, day);
    // sale 73000 gross, LAIT line 36000 returned
    assert.equal(ledger.totalTtcCt, 73000 - 36000);
    assert.equal(ledger.totalHtCt, 63280 - 33028);
    assert.equal(ledger.tva9BaseCt, 33028 - 33028);
    assert.equal(ledger.returnsCount, 1);
    assert.equal(ledger.returnsTotalTtcCt, 36000);
    // timbre is NOT refunded
    assert.equal(ledger.totalTimbreCt, 1000);
    // finalize with the ledger's own net passes; a lie fails
    const totals = {
      salesCount: ledger.salesCount, totalHtCt: ledger.totalHtCt, tva0BaseCt: ledger.tva0BaseCt,
      tva9BaseCt: ledger.tva9BaseCt, tva9AmtCt: ledger.tva9AmtCt, tva19BaseCt: ledger.tva19BaseCt,
      tva19AmtCt: ledger.tva19AmtCt, totalTvaCt: ledger.totalTvaCt, totalTimbreCt: ledger.totalTimbreCt,
      totalTtcCt: ledger.totalTtcCt, especesGrossCt: ledger.especesGrossCt, cibTotalCt: ledger.cibTotalCt,
      dahabiyaTotalCt: ledger.dahabiyaTotalCt, creditGrantedCt: ledger.creditGrantedCt,
      creditCollectedCt: ledger.creditCollectedCt, firstInvoice: ledger.firstInvoice, lastInvoice: ledger.lastInvoice,
      returnsCount: ledger.returnsCount, returnsTotalTtcCt: ledger.returnsTotalTtcCt,
      lossesCount: ledger.lossesCount, lossesTotalCt: ledger.lossesTotalCt,
    };
    const z = b.finalizeZReport({ day, openingTime: '08:00', closingTime: '20:00', totals });
    assert.match(z.report_number, /^Z-/);
    const row = b.db.prepare('SELECT returns_count, returns_total_ttc_ct FROM z_reports WHERE report_number = ?').get(z.report_number) as { returns_count: number; returns_total_ttc_ct: number };
    assert.equal(row.returns_count, 1);
    assert.equal(row.returns_total_ttc_ct, 36000);
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('v1.5.0: sale lookup by FACT or id feeds the draft screen (remaining math)', () => {
  const p = tmpFile('lookup');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    b.openCashSession('Amine', 1000000);
    const sale = recordTodaySale(b, 'ESPECES');
    // by FACT number and by UUID id alike
    for (const key of [sale.invoice_number, sale.id]) {
      const f = b.getSaleForReturn(key);
      assert.ok(f, `found by ${key.slice(0, 8)}…`);
      assert.equal(f!.sale.invoice_number, sale.invoice_number);
      assert.equal(f!.sale.status, 'COMPLETED');
      assert.equal(f!.items.length, 2);
      assert.equal(f!.items[0].remaining_milli, 2000);
      assert.equal(f!.items[0].returned_milli, 0);
    }
    assert.equal(b.getSaleForReturn('FACT-2099-999999'), null);
    assert.equal(b.getSaleForReturn('   '), null);
    // Smart lookup (supermarket lane): lowercase + spaces, digits-only short,
    // and unique invoice suffix all resolve to the same sale.
    const tail6 = sale.invoice_number.slice(-6);
    assert.equal(b.getSaleForReturn(sale.invoice_number.toLowerCase())!.sale.invoice_number, sale.invoice_number);
    assert.equal(b.getSaleForReturn(`  ${sale.invoice_number.toLowerCase()}  `)!.sale.invoice_number, sale.invoice_number);
    assert.equal(b.getSaleForReturn(String(Number(tail6)))!.sale.invoice_number, sale.invoice_number);
    assert.equal(b.getSaleForReturn(tail6)!.sale.invoice_number, sale.invoice_number);
    // after a full approval the line shows consumed
    const [la] = saleItemIds(b, sale.id);
    const d = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 2000 }], reason: 'DEFECT', actor: 'lina' });
    b.approveReturn(d.id, 'karim', 'manager');
    const f2 = b.getSaleForReturn(sale.invoice_number);
    assert.equal(f2!.items[0].returned_milli, 2000);
    assert.equal(f2!.items[0].remaining_milli, 0);
    assert.equal(f2!.items[1].remaining_milli, 3000);
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('A1 (supermarket): disposition defaults, DESTROY waste ledger, explicit override', () => {
  const p = tmpFile('disposition');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    b.openCashSession('Amine', 1000000);
    const sale = recordTodaySale(b);
    const [la] = saleItemIds(b, sale.id);
    const baseStock = b.getProduct(1).stock_milli;

    // EXPIRED → DESTROY: no restock + one waste row at buy cost.
    const d1 = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 1000 }], reason: 'EXPIRED', actor: 'lina' });
    b.approveReturn(d1.id, 'karim', 'manager');
    assert.equal(b.getProduct(1).stock_milli, baseStock);
    const losses = b.getInventoryLosses({});
    assert.equal(losses.length, 1);
    assert.equal(losses[0].reason, 'EXPIRED');
    assert.equal(losses[0].qty_milli, 1000);
    assert.equal(losses[0].unit_cost_ct, PROD.buy_price_ct);
    assert.equal(losses[0].total_loss_ct, Math.round((PROD.buy_price_ct * 1000) / 1000));

    // Bad disposition code → hard refuse.
    const d2 = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 500 }], reason: 'DEFECT', actor: 'lina' });
    const riId = ((b.getReturnOrNull(d2.id) as Record<string, unknown>).items as { id: number }[])[0].id;
    assert.throws(() => b.approveReturn(d2.id, 'karim', 'manager', { [riId]: 'BURN' as never }), /bad disposition/);

    // Explicit RESTOCK overrides DEFECT→QUARANTINE default → stock flows back.
    const before = b.getProduct(1).stock_milli;
    b.approveReturn(d2.id, 'karim', 'manager', { [riId]: 'RESTOCK' });
    assert.equal(b.getProduct(1).stock_milli, before + 500);

    // QUARANTINE is listed for the supplier rep — make one DEFECT stay default.
    const d3 = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 500 }], reason: 'DEFECT', actor: 'lina' });
    b.approveReturn(d3.id, 'karim', 'manager');
    const quar = b.listQuarantine(100);
    assert.ok(quar.length >= 1);
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('B-credit (supermarket): CREDIT sale posts debt; approved return reverses it', () => {
  const p = tmpFile('bcredit');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    b.db.prepare('INSERT INTO clients (id, name, phone, credit_balance_ct, max_credit_limit_ct) VALUES (30, ?, ?, 0, 0)').run('CLIENT 30', '0550000000');
    const bal = () => (b.db.prepare('SELECT credit_balance_ct FROM clients WHERE id = 30').get() as { credit_balance_ct: number }).credit_balance_ct;
    // The debt posts at commit — stored balance matches the derived statement.
    const sale = recordTodaySale(b, 'CREDIT', 30);
    const ttc = (b.getSale(sale.id) as Record<string, unknown>).total_ttc_ct as number;
    assert.ok(ttc > 0);
    assert.equal(bal(), ttc);
    // Full first-line return (CHANGED_MIND → RESTOCK, no cash session needed).
    const [la] = saleItemIds(b, sale.id);
    const d = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: la, qty_milli: 2000 }], reason: 'CHANGED_MIND', actor: 'lina' });
    const ap = b.approveReturn(d.id, 'karim', 'manager');
    assert.ok(ap.refund_ct > 0);
    assert.equal(bal(), ttc - ap.refund_ct);
    // The client statement itemizes the reversal; the audit names it.
    const st = b.getClientStatement(30);
    assert.equal(st.creditReturns.length, 1);
    const audit = b.listAudit(50).find(r => r.action === 'return.approve' && r.entity_id === d.id);
    assert.ok(audit && audit.detail.includes(`cred-${ap.refund_ct}`));
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});

test('V-credit: voiding a CREDIT sale gives the debt back; void after approved return refused', () => {
  const p = tmpFile('vcredit');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    b.db.prepare('INSERT INTO clients (id, name, phone, credit_balance_ct, max_credit_limit_ct) VALUES (31, ?, ?, 0, 0)').run('CLIENT 31', '0550000000');
    const bal = () => (b.db.prepare('SELECT credit_balance_ct FROM clients WHERE id = 31').get() as { credit_balance_ct: number }).credit_balance_ct;
    const ttcOf = (id: string) => (b.getSale(id) as Record<string, unknown>).total_ttc_ct as number;
    // Void returns the posted debt, exactly once.
    const s1 = recordTodaySale(b, 'CREDIT', 31);
    assert.equal(bal(), ttcOf(s1.id));
    b.voidSale(s1.id, 'erreur de saisie', 'karim');
    assert.equal(bal(), 0);
    // A sale with an approved return can no longer be voided (no double refund).
    const s2 = recordTodaySale(b, 'CREDIT', 31);
    const ttc2 = ttcOf(s2.id);
    const [la] = saleItemIds(b, s2.id);
    const d = b.createReturnDraft({ sale_id: s2.id, lines: [{ saleItemId: la, qty_milli: 2000 }], reason: 'CHANGED_MIND', actor: 'lina' });
    const ap = b.approveReturn(d.id, 'karim', 'manager');
    assert.throws(() => b.voidSale(s2.id, 'trop tard', 'karim'), /approved returns/);
    assert.equal(bal(), ttc2 - ap.refund_ct);
    b.close();
  } finally {
    for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
  }
});
