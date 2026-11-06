import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openBarakaDb, computeDayAggregates } from './sqlite.js';
import type { SaleHeaderInput, SaleItemInput } from './sqlite.js';
import { GENESIS_PREV_HASH, verifyZChain, type ZReport } from '../core/zreport.js';
import { fiscalDayISO } from '../core/fiscal-day.js';
import { buildZTicketText, type ZTicketData } from '../core/z-ticket.js';

const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
let n = 0;
const tmpFile = () => {
  n += 1;
  const p = path.join(TMP, `zc-${process.pid}-${n}.db`);
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* fresh */ }
  }
  return p;
};

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

// TVA breakdown with a single active tier (others zero) — mirrors the
// recordSale tier validation exactly.
const header = (
  method: 'ESPECES' | 'CIB', ht: number, tva: number, timbre: number,
  tier: 0 | 9 | 19, createdAt: string,
): SaleHeaderInput => {
  const bd = (active: boolean) => active
    ? { rate: tier as 0, base_ht_ct: ht, tva_amount_ct: tva, total_ttc_ct: ht + tva }
    : { rate: 0 as const, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 };
  return {
    cashier_id: 'c1', cashier_name: 'Yacine', payment_method: method,
    amount_paid_ct: ht + tva + timbre, amount_returned_ct: 0,
    created_at: createdAt,
    totals: {
      total_ht_ct: ht, total_tva_ct: tva, timbre_ct: timbre, total_ttc_ct: ht + tva + timbre,
      tva_breakdown: { 0: bd(tier === 0), 9: bd(tier === 9), 19: bd(tier === 19) },
    },
  };
};

const seedClient = (b: ReturnType<typeof openBarakaDb>) => {
  (b as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
    .prepare('INSERT INTO clients (id, name, phone, credit_balance_ct, max_credit_limit_ct) VALUES (?, ?, ?, ?, 0)')
    .run(30, 'CLIENT 30', '0550000000', 500000);
};

// Day 1 ledger: A (ESPECES 9%: 10000+900, timbre 1000 -> 11900) +
// B (CIB 19%: 50000+9500 -> 59500) + ESPECES settlement 20000 (+1000 timbre).
const DAY1 = '2026-10-26';
const totalsDay1 = () => ({
  salesCount: 2, totalHtCt: 60000, tva0BaseCt: 0, tva9BaseCt: 10000,
  tva9AmtCt: 900, tva19BaseCt: 50000, tva19AmtCt: 9500, totalTvaCt: 10400,
  totalTimbreCt: 1000, totalTtcCt: 71400, especesGrossCt: 11900,
  cibTotalCt: 59500, dahabiyaTotalCt: 0, creditGrantedCt: 0,
  creditCollectedCt: 21000, firstInvoice: 'FACT-2026-000001', lastInvoice: 'FACT-2026-000002',
  returnsCount: 0, returnsTotalTtcCt: 0,
});

const seedDay1 = (b: ReturnType<typeof openBarakaDb>) => {
  b.upsertProduct(PROD);
  seedClient(b);
  b.recordSale(header('ESPECES', 10000, 900, 1000, 9, `${DAY1}T09:00:00.000Z`), [item(10000, 900, 9)]);
  b.recordSale(header('CIB', 50000, 9500, 0, 19, `${DAY1}T11:00:00.000Z`), [item(50000, 9500, 19)]);
  b.settleClientCredit({ clientId: 30, amountCt: 20000, paymentMethod: 'ESPECES', date: `${DAY1}T12:00:00.000Z` });
};

const closeIn = (b: ReturnType<typeof openBarakaDb>, day: string, totals: ReturnType<typeof totalsDay1>) =>
  b.finalizeZReport({ day, openingTime: '08:00', closingTime: '20:00', totals });

test('zclose: settle -> close -> verify-chain e2e; ticket reprint is byte-identical', () => {
  const p = tmpFile();
  const b = openBarakaDb(p);
  seedDay1(b);
  // Ledger-truth matches the hand-computed vector (independent recompute).
  assert.deepEqual(computeDayAggregates(b.db, DAY1), { ...totalsDay1() });
  const z1 = closeIn(b, DAY1, totalsDay1());
  assert.equal(z1.report_number, 'Z-2026-000001');
  assert.equal(z1.prev_hash, GENESIS_PREV_HASH);
  // Hash pinned against node:crypto (independent of src/core/sha256.ts).
  const expectHash = createHash('sha256')
    .update(`${GENESIS_PREV_HASH}||Z-2026-000001||${DAY1}||71400||1000`)
    .digest('hex');
  assert.equal(z1.hash, expectHash);
  // Chain verifies over the stored rows; the reprint renders byte-identical
  // from the stored record (printed Z == reprinted Z).
  const rows = (b.listZReports() as Array<Record<string, unknown>>).map(r => ({
    reportNumber: r.report_number, date: r.day, openingTime: r.opening_time,
    closingTime: r.closing_time, prevHash: r.prev_hash, hash: r.hash,
    salesCount: r.total_sales_count, totalHtCt: r.total_ht_ct,
    tva0BaseCt: r.tva0_base_ct, tva9BaseCt: r.tva9_base_ct, tva9AmtCt: r.tva9_amt_ct,
    tva19BaseCt: r.tva19_base_ct, tva19AmtCt: r.tva19_amt_ct, totalTvaCt: r.total_tva_ct,
    totalTimbreCt: r.total_timbre_ct, totalTtcCt: r.total_ttc_ct,
    especesGrossCt: r.especes_gross_ct,
    cibTotalCt: r.cib_total_ct, dahabiyaTotalCt: r.dahabiya_total_ct,
    creditGrantedCt: r.credit_granted_ct, creditCollectedCt: r.credit_collected_ct,
    firstInvoice: r.first_invoice_number, lastInvoice: r.last_invoice_number,
  })) as unknown as ZReport[];
  assert.deepEqual(verifyZChain(rows), { ok: true, failedAt: null });
  const ticket = (r: ZReport): string => buildZTicketText({
    storeName: 'S', owner: 'O', address: 'A', rc: 'R', nif: 'N', nis: 'S2', ai: 'AI',
    reportNumber: r.reportNumber, date: r.date, closingTime: r.closingTime,
    firstInvoice: r.firstInvoice, lastInvoice: r.lastInvoice, salesCount: r.salesCount,
    totalHtCt: r.totalHtCt, tva0BaseCt: r.tva0BaseCt, tva9BaseCt: r.tva9BaseCt,
    tva9AmtCt: r.tva9AmtCt, tva19BaseCt: r.tva19BaseCt, tva19AmtCt: r.tva19AmtCt,
    totalTvaCt: r.totalTvaCt, totalTimbreCt: r.totalTimbreCt, totalTtcCt: r.totalTtcCt,
    especesGrossCt: r.especesGrossCt, bankTotalCt: r.cibTotalCt + r.dahabiyaTotalCt,
    creditGrantedCt: r.creditGrantedCt, creditCollectedCt: r.creditCollectedCt,
    prevHash: r.prevHash, hash: r.hash, finalized: true,
  } as ZTicketData);
  assert.equal(ticket(rows[0]), ticket(rows[0])); // determinism
  assert.match(ticket(rows[0]), /Z-2026-000001 - FINALISE/);
  assert.match(ticket(rows[0]), /TOTAL TTC: 714\.00 DZD/);
  b.close();
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
});

test('zclose: duplicate DAY close refused; tampered totals refused', () => {
  const p = tmpFile();
  const b = openBarakaDb(p);
  seedDay1(b);
  closeIn(b, DAY1, totalsDay1());
  assert.throws(() => closeIn(b, DAY1, totalsDay1()), /already legally closed/);
  // Same-day close with a forged total is refused BEFORE the day-lock trips
  // on a fresh sibling day: tamper check fires on cloned content.
  const forged = { ...totalsDay1(), totalTtcCt: 71401 };
  assert.throws(() => closeIn(b, DAY1, forged), /already legally closed/);
  b.close();
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
});

test('zclose: forged totals on an OPEN day are refused with field detail', () => {
  const p = tmpFile();
  const b = openBarakaDb(p);
  seedDay1(b);
  const forged = { ...totalsDay1(), totalTtcCt: 71401, especesGrossCt: 11901 };
  assert.throws(() => closeIn(b, DAY1, forged), /do not match.*totalTtcCt.*especesGrossCt/);
  b.close();
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
});

test('zclose: locked day freezes voids, late sales and shift closes', () => {
  const p = tmpFile();
  const b = openBarakaDb(p);
  seedDay1(b);
  const s = b.openCashSession('Yacine', 100000);
  closeIn(b, DAY1, totalsDay1());
  const saleId = (b as unknown as { db: { prepare: (s: string) => { get: (...a: unknown[]) => { id: string } } } }).db
    .prepare('SELECT id FROM sales ORDER BY rowid LIMIT 1').get().id as string;
  assert.throws(() => b.voidSale(saleId, 'late regret', 'owner'), /legally closed/);
  assert.throws(
    () => b.recordSale(header('CIB', 1000, 0, 0, 0, `${DAY1}T15:00:00.000Z`), [item(1000, 0, 0)]),
    /legally closed/,
  );
  // A shift whose window lands on a locked day is refused: freeze today,
  // then the shift close (periodEnd = now) must trip the day lock.
  // F2: "today" is the LOCAL day, or the suite flakes in the 23:00–00:00Z hour.
  const today = fiscalDayISO();
  b.recordSale(header('CIB', 1000, 0, 0, 0, `${today}T09:00:00.000Z`), [item(1000, 0, 0)]);
  b.finalizeZReport({
    day: today, openingTime: '08:00', closingTime: '20:00',
    totals: {
      salesCount: 1, totalHtCt: 1000, tva0BaseCt: 1000, tva9BaseCt: 0,
      tva9AmtCt: 0, tva19BaseCt: 0, tva19AmtCt: 0, totalTvaCt: 0,
      totalTimbreCt: 0, totalTtcCt: 1000, especesGrossCt: 0,
      cibTotalCt: 1000, dahabiyaTotalCt: 0, creditGrantedCt: 0,
      creditCollectedCt: 0, firstInvoice: 'FACT-2026-000003', lastInvoice: 'FACT-2026-000003',
      returnsCount: 0, returnsTotalTtcCt: 0,
    },
  });
  assert.throws(() => b.closeCashSessionAndGenerateZ(s.id, 100000), /legally closed/);
  // The next day still closes and chains onto the day-1 hash.
  b.recordSale(header('CIB', 1000, 0, 0, 0, '2026-10-27T09:00:00.000Z'), [item(1000, 0, 0)]);
  const z2 = b.finalizeZReport({
    day: '2026-10-27', openingTime: '08:00', closingTime: '20:00',
    totals: {
      salesCount: 1, totalHtCt: 1000, tva0BaseCt: 1000, tva9BaseCt: 0,
      tva9AmtCt: 0, tva19BaseCt: 0, tva19AmtCt: 0, totalTvaCt: 0,
      totalTimbreCt: 0, totalTtcCt: 1000, especesGrossCt: 0,
      cibTotalCt: 1000, dahabiyaTotalCt: 0, creditGrantedCt: 0,
      creditCollectedCt: 0, firstInvoice: 'FACT-2026-000004', lastInvoice: 'FACT-2026-000004',
      returnsCount: 0, returnsTotalTtcCt: 0,
    },
  });
  assert.equal(z2.report_number, 'Z-2026-000003');
  b.close();
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
});

test('zclose: F2 — a 00:30 local sale belongs to the NEW local day, never UTC yesterday', () => {
  const p = tmpFile();
  const b = openBarakaDb(p);
  b.upsertProduct(PROD);
  // 2026-10-26T23:30:00Z == 2026-10-27T00:30:00+01:00 (Algiers).
  const edge = b.recordSale(header('CIB', 1000, 0, 0, 0, '2026-10-26T23:30:00.000Z'), [item(1000, 0, 0)]);
  // UTC-yesterday's book is empty; the new local day owns the sale.
  assert.equal(computeDayAggregates(b.db, '2026-10-26').salesCount, 0);
  const agg27 = computeDayAggregates(b.db, '2026-10-27');
  assert.equal(agg27.salesCount, 1);
  assert.equal(agg27.firstInvoice, edge.invoice_number);
  // Attribution follows the local day: locking 27 freezes the edge sale…
  closeIn(b, '2026-10-27', agg27);
  assert.throws(
    () => b.recordSale(header('CIB', 1000, 0, 0, 0, '2026-10-26T23:45:00.000Z'), [item(1000, 0, 0)]),
    /legally closed/,
  );
  assert.throws(() => b.voidSale(edge.id, 'late regret', 'owner'), /legally closed/);
  b.close();
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
});
