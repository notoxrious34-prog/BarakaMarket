import test from 'node:test';
import assert from 'node:assert/strict';
import { openBarakaDb, computeDayAggregates, RAPIDE_CAP_DAY_KEY, RAPIDE_CAP_CASHIER_KEY } from './sqlite.js';
import type { SaleItemInput } from './sqlite.js';
import { calculateLineTotalsCt, calculateSaleTotalsCt } from '../core/fiscal.centimes.js';

const DAY = '2026-11-25';
const NOON = '2026-11-25T10:00:00.000Z'; // 11:00 Algiers — inside DAY window

/** One rapide (codeless) line of `priceCt` DZD-centimes, TVA 0. */
function rapideItem(priceCt: number): SaleItemInput {
  const line = calculateLineTotalsCt(priceCt, 1, 0);
  return {
    product_id: 0, barcode: '*PRIX-LIBRE*', name_fr: 'RAPIDE', name_ar: 'سريع',
    unit_price_ct: priceCt, qty_milli: 1000, unit: 'PIECE', tva_rate: 0,
    discount_bp: 0, line_ht_ct: line.total_line_ht_ct,
    line_tva_ct: line.total_line_tva_ct, line_ttc_ct: line.total_line_ttc_ct,
  };
}

/** One catalog line (control: never counted as rapide). */
function catalogItem(): SaleItemInput {
  const line = calculateLineTotalsCt(5000, 1, 0);
  return {
    product_id: 424242, barcode: 'x', name_fr: 'GHOST', name_ar: '',
    unit_price_ct: 5000, qty_milli: 1000, unit: 'PIECE', tva_rate: 0,
    discount_bp: 0, line_ht_ct: line.total_line_ht_ct,
    line_tva_ct: line.total_line_tva_ct, line_ttc_ct: line.total_line_ttc_ct,
  };
}

function sell(b: ReturnType<typeof openBarakaDb>, id: string, items: SaleItemInput[], cashier = 'C-1', at = NOON) {
  const t = calculateSaleTotalsCt(items.map(i => ({ tva_rate: i.tva_rate, ...{ total_line_ht_ct: i.line_ht_ct, total_line_tva_ct: i.line_tva_ct, total_line_ttc_ct: i.line_ttc_ct } })), 'ESPECES');
  return b.recordSale({
    id, cashier_id: cashier, cashier_name: 'Amine', payment_method: 'ESPECES',
    amount_paid_ct: t.total_ttc_ct, amount_returned_ct: 0, totals: t, created_at: at,
  }, items);
}

test('db ADR-051 P2: fresh file migrates to v16 with rapide columns', () => {
  const b = openBarakaDb(':memory:');
  const v = (b.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  assert.equal(v, 16);
  const cols = b.db.prepare('PRAGMA table_info(z_reports)').all() as { name: string }[];
  assert.ok(cols.some(c => c.name === 'rapide_count'), 'rapide_count column');
  assert.ok(cols.some(c => c.name === 'rapide_total_ttc_ct'), 'rapide_total_ttc_ct column');
  b.close();
});

test('db ADR-051 P2: aggregates count rapide lines only (catalog excluded)', () => {
  const b = openBarakaDb(':memory:');
  sell(b, 'p2-m1', [rapideItem(25000)]);
  sell(b, 'p2-m2', [rapideItem(15000)]);
  sell(b, 'p2-m3', [catalogItem()]);
  const agg = computeDayAggregates(b.db, DAY);
  assert.equal(agg.rapideCount, 2);
  assert.equal(agg.rapideTotalTtcCt, 40000);
  assert.equal(agg.salesCount, 3);
  b.close();
});

test('db ADR-051 P2: DAY close stores the memo; a forged memo refuses', () => {
  const b = openBarakaDb(':memory:');
  sell(b, 'p2-z1', [rapideItem(30000)]);
  const ledger = computeDayAggregates(b.db, DAY);
  const totals = {
    salesCount: ledger.salesCount, totalHtCt: ledger.totalHtCt, tva0BaseCt: ledger.tva0BaseCt,
    tva9BaseCt: ledger.tva9BaseCt, tva9AmtCt: ledger.tva9AmtCt, tva19BaseCt: ledger.tva19BaseCt,
    tva19AmtCt: ledger.tva19AmtCt, totalTvaCt: ledger.totalTvaCt, totalTimbreCt: ledger.totalTimbreCt,
    totalTtcCt: ledger.totalTtcCt, especesGrossCt: ledger.especesGrossCt, cibTotalCt: ledger.cibTotalCt,
    dahabiyaTotalCt: ledger.dahabiyaTotalCt, creditGrantedCt: ledger.creditGrantedCt,
    creditCollectedCt: ledger.creditCollectedCt, firstInvoice: ledger.firstInvoice, lastInvoice: ledger.lastInvoice,
    returnsCount: ledger.returnsCount, returnsTotalTtcCt: ledger.returnsTotalTtcCt,
    lossesCount: ledger.lossesCount, lossesTotalCt: ledger.lossesTotalCt,
    rapideCount: ledger.rapideCount, rapideTotalTtcCt: ledger.rapideTotalTtcCt,
  };
  const z = b.finalizeZReport({ day: DAY, openingTime: '08:00', closingTime: '20:00', totals });
  const row = b.db.prepare('SELECT rapide_count, rapide_total_ttc_ct FROM z_reports WHERE report_number = ?').get(z.report_number) as { rapide_count: number; rapide_total_ttc_ct: number };
  assert.equal(row.rapide_count, 1);
  assert.equal(row.rapide_total_ttc_ct, 30000);
  b.close();
});

test('db ADR-051 P2: DAY close refuses a forged rapide memo (ledger mismatch)', () => {
  const b = openBarakaDb(':memory:');
  sell(b, 'p2-z2', [rapideItem(30000)]);
  const ledger = computeDayAggregates(b.db, DAY);
  const totals = {
    salesCount: ledger.salesCount, totalHtCt: ledger.totalHtCt, tva0BaseCt: ledger.tva0BaseCt,
    tva9BaseCt: ledger.tva9BaseCt, tva9AmtCt: ledger.tva9AmtCt, tva19BaseCt: ledger.tva19BaseCt,
    tva19AmtCt: ledger.tva19AmtCt, totalTvaCt: ledger.totalTvaCt, totalTimbreCt: ledger.totalTimbreCt,
    totalTtcCt: ledger.totalTtcCt, especesGrossCt: ledger.especesGrossCt, cibTotalCt: ledger.cibTotalCt,
    dahabiyaTotalCt: ledger.dahabiyaTotalCt, creditGrantedCt: ledger.creditGrantedCt,
    creditCollectedCt: ledger.creditCollectedCt, firstInvoice: ledger.firstInvoice, lastInvoice: ledger.lastInvoice,
    returnsCount: ledger.returnsCount, returnsTotalTtcCt: ledger.returnsTotalTtcCt,
    lossesCount: ledger.lossesCount, lossesTotalCt: ledger.lossesTotalCt,
    rapideCount: ledger.rapideCount, rapideTotalTtcCt: ledger.rapideTotalTtcCt,
  };
  // Forged memo (off by one) must refuse — same class as returns/scrappage.
  assert.throws(
    () => b.finalizeZReport({ day: DAY, openingTime: '08:00', closingTime: '20:00', totals: { ...totals, rapideCount: 2 } }),
    /rapideCount: caller=2 ledger=1/,
  );
  // The day is still open: the honest close commits afterwards.
  const z = b.finalizeZReport({ day: DAY, openingTime: '08:00', closingTime: '20:00', totals });
  assert.match(z.report_number, /^Z-/);
  b.close();
});

test('db ADR-051 P2: day cap refuses over-cap rapide, spares catalog sales', () => {
  const b = openBarakaDb(':memory:');
  b.setMeta(RAPIDE_CAP_DAY_KEY, '50000'); // 500.00 DZD
  sell(b, 'p2-c1', [rapideItem(30000)]); // 300 under cap — commits
  assert.throws(() => sell(b, 'p2-c2', [rapideItem(25000)]), /RAPIDE_CAP_EXCEEDED/); // 550 > 500
  sell(b, 'p2-c3', [catalogItem()]); // catalog big sale unaffected by the cap
  const agg = computeDayAggregates(b.db, DAY);
  assert.equal(agg.rapideCount, 1);
  assert.equal(agg.salesCount, 2);
  b.close();
});

test('db ADR-051 P2: cashier cap scopes per cashier; absent cap = unlimited', () => {
  const b = openBarakaDb(':memory:');
  b.setMeta(RAPIDE_CAP_CASHIER_KEY, '20000');
  sell(b, 'p2-k1', [rapideItem(20000)], 'C-1'); // at cap — commits
  assert.throws(() => sell(b, 'p2-k2', [rapideItem(1000)], 'C-1'), /RAPIDE_CAP_EXCEEDED/);
  sell(b, 'p2-k3', [rapideItem(20000)], 'C-2'); // other cashier unaffected
  b.close();
  const b2 = openBarakaDb(':memory:'); // no caps at all
  sell(b2, 'p2-u1', [rapideItem(99999999)]);
  assert.equal(computeDayAggregates(b2.db, DAY).rapideCount, 1);
  b2.close();
});

test('db ADR-051 P2: SHIFT close carries the rapide memo', () => {
  const b = openBarakaDb(':memory:');
  const s = b.openCashSession('Yacine', 100000);
  // created_at = now so the sale falls inside the shift window just opened.
  sell(b, 'p2-s1', [rapideItem(12000)], 'C-1', new Date().toISOString());
  const zc = b.closeCashSessionAndGenerateZ(s.id, 112000);
  assert.equal(zc.rapideCount, 1);
  assert.equal(zc.rapideTotalTtcCt, 12000);
  const row = b.db.prepare("SELECT rapide_count, rapide_total_ttc_ct FROM z_reports WHERE close_kind = 'SHIFT' ORDER BY rowid DESC LIMIT 1").get() as { rapide_count: number; rapide_total_ttc_ct: number };
  assert.equal(row.rapide_count, 1);
  assert.equal(row.rapide_total_ttc_ct, 12000);
  b.close();
});
