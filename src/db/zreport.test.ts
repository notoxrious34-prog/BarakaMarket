import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from './sqlite.js';
import { GENESIS_PREV_HASH, computeZHash, finalizeZReport, verifyZChain, type ZReport } from '../core/zreport.js';

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

test('core: finalize attaches prev/hash; chain verifies; tamper detected', () => {
  const agg = {
    salesCount: 2, totalHtCt: 100000, tva0BaseCt: 20000, tva9BaseCt: 30000,
    tva9AmtCt: 2700, tva19BaseCt: 50000, tva19AmtCt: 9500, totalTvaCt: 12200,
    totalTimbreCt: 1100, totalTtcCt: 113300, especesGrossCt: 90000,
    cibTotalCt: 23300, dahabiyaTotalCt: 0, creditGrantedCt: 0,
    creditCollectedCt: 5000, firstInvoice: 'FACT-2026-000101', lastInvoice: 'FACT-2026-000102',
  };
  const z1 = finalizeZReport(
    { reportNumber: 'Z-2026-000001', date: '2026-10-26', openingTime: '08:00', closingTime: '20:00', prevHash: GENESIS_PREV_HASH },
    agg,
  );
  assert.equal(z1.hash, computeZHash(GENESIS_PREV_HASH, 'Z-2026-000001', '2026-10-26', 113300, 1100));
  const z2 = finalizeZReport(
    { reportNumber: 'Z-2026-000002', date: '2026-10-27', openingTime: '08:00', closingTime: '20:00', prevHash: z1.hash },
    { ...agg, totalTtcCt: 50000, totalTimbreCt: 500 },
  );
  assert.deepEqual(verifyZChain([z1, z2]), { ok: true, failedAt: null });
  const forged = { ...z2, totalTtcCt: 50001 };
  assert.deepEqual(verifyZChain([z1, forged]), { ok: false, failedAt: 'Z-2026-000002' });
  const relinked = { ...z2, prevHash: GENESIS_PREV_HASH };
  assert.deepEqual(verifyZChain([z1, relinked]), { ok: false, failedAt: 'Z-2026-000002' });
  void (null as unknown as ZReport | null);
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
