import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from './sqlite.js';
import { GENESIS_PREV_HASH, computeZHash, verifyZChain, type ZReport } from '../core/zreport.js';

const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
let n = 0;
const tmpFile = () => {
  n += 1;
  const p = path.join(TMP, `z-${process.pid}-${n}.db`);
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* fresh */ }
  }
  return p;
};

const totals = (ttc: number, timbre: number) => ({
  salesCount: 2, totalHtCt: 100000, tva0BaseCt: 20000, tva9BaseCt: 30000,
  tva9AmtCt: 2700, tva19BaseCt: 50000, tva19AmtCt: 9500, totalTvaCt: 12200,
  totalTimbreCt: timbre, totalTtcCt: ttc, especesGrossCt: 90000,
  cibTotalCt: 23300, dahabiyaTotalCt: 0, creditGrantedCt: 0,
  creditCollectedCt: 5000, firstInvoice: 'FACT-2026-000101', lastInvoice: 'FACT-2026-000102',
});

test('db: Z1 anchors genesis, Z2 chains, numbers are monotonic pad6', () => {
  const p = tmpFile();
  const baraka = openBarakaDb(p);
  assert.equal(baraka.getLatestZHash(), GENESIS_PREV_HASH);
  const z1 = baraka.finalizeZReport({ day: '2026-10-26', openingTime: '08:00', closingTime: '20:00', totals: totals(113300, 1100) });
  assert.equal(z1.report_number, 'Z-2026-000001');
  assert.equal(z1.prev_hash, GENESIS_PREV_HASH);
  assert.equal(z1.hash, computeZHash(GENESIS_PREV_HASH, 'Z-2026-000001', '2026-10-26', 113300, 1100));
  const z2 = baraka.finalizeZReport({ day: '2026-10-27', openingTime: '08:00', closingTime: '20:00', totals: totals(50000, 500) });
  assert.equal(z2.report_number, 'Z-2026-000002');
  assert.equal(z2.prev_hash, z1.hash);
  const rows = (baraka.listZReports() as Array<Record<string, unknown>>).map(r => ({
    reportNumber: r.report_number, date: r.day, prevHash: r.prev_hash, hash: r.hash,
    totalTtcCt: r.total_ttc_ct, totalTimbreCt: r.total_timbre_ct,
  })) as unknown as ZReport[];
  assert.equal(rows.length, 2);
  assert.deepEqual(verifyZChain(rows), { ok: true, failedAt: null });
  baraka.close();
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
});

test('db: meta round-trips license + machine seed', () => {
  const p = tmpFile();
  const baraka = openBarakaDb(p);
  assert.equal(baraka.getMeta('license_status'), null);
  baraka.setMeta('license_status', 'ACTIVATED');
  baraka.setMeta('baraka_machine_seed', 'seed-xyz');
  assert.equal(baraka.getMeta('license_status'), 'ACTIVATED');
  assert.equal(baraka.getMeta('baraka_machine_seed'), 'seed-xyz');
  baraka.close();
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
});
