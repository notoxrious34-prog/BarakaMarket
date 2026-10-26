import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENESIS_PREV_HASH, formatZNumber, computeZHash, finalizeZReport,
  verifyZChain, crossCheckLedger, type ZAggregatesCt,
} from './zreport';

const agg = (over: Partial<ZAggregatesCt> = {}): ZAggregatesCt => ({
  salesCount: 2,
  totalHtCt: 100000, tva0BaseCt: 20000, tva9BaseCt: 30000, tva9AmtCt: 2700,
  tva19BaseCt: 50000, tva19AmtCt: 9500, totalTvaCt: 12200,
  totalTimbreCt: 1100, totalTtcCt: 113300,
  especesGrossCt: 90000, cibTotalCt: 23300, dahabiyaTotalCt: 0,
  creditGrantedCt: 0, creditCollectedCt: 5000,
  firstInvoice: 'FACT-2026-000101', lastInvoice: 'FACT-2026-000102',
  ...over,
});

describe('zreport: tamper-evident fiscal chain', () => {
  it('Z numbers are Z-YYYY-XXXXXX monotonic pad6', () => {
    assert.equal(formatZNumber(2026, 1), 'Z-2026-000001');
    assert.equal(formatZNumber(2026, 250), 'Z-2026-000250');
  });

  it('Z1 anchors on genesis; Z2 links to Z1 hash', () => {
    const z1 = finalizeZReport(
      { reportNumber: 'Z-2026-000001', date: '2026-10-26', openingTime: '08:00', closingTime: '20:00', prevHash: GENESIS_PREV_HASH },
      agg(),
    );
    assert.equal(z1.prevHash, GENESIS_PREV_HASH);
    assert.equal(z1.hash, computeZHash(GENESIS_PREV_HASH, 'Z-2026-000001', '2026-10-26', 113300, 1100));
    const z2 = finalizeZReport(
      { reportNumber: 'Z-2026-000002', date: '2026-10-27', openingTime: '08:00', closingTime: '20:00', prevHash: z1.hash },
      agg({ salesCount: 1, totalTtcCt: 50000 }),
    );
    assert.equal(z2.prevHash, z1.hash);
    assert.deepEqual(verifyZChain([z1, z2]), { ok: true, failedAt: null });
  });

  it('rewritten history breaks the chain', () => {
    const z1 = finalizeZReport(
      { reportNumber: 'Z-2026-000001', date: '2026-10-26', openingTime: '08:00', closingTime: '20:00', prevHash: GENESIS_PREV_HASH },
      agg(),
    );
    const tampered = { ...z1, totalTtcCt: z1.totalTtcCt + 100 };
    assert.deepEqual(verifyZChain([tampered]).failedAt, 'Z-2026-000001');
    const z2 = finalizeZReport(
      { reportNumber: 'Z-2026-000002', date: '2026-10-27', openingTime: '08:00', closingTime: '20:00', prevHash: 'f'.repeat(64) },
      agg(),
    );
    assert.equal(verifyZChain([z1, z2]).ok, false);
  });

  it('ledger cross-check passes clean, flags a tampered line', () => {
    const a = agg();
    const lines = [
      { totalHtCt: 80000, totalTvaCt: 12200, totalTimbreCt: 900, totalTtcCt: 93100, tva0BaseCt: 20000, tva9BaseCt: 30000, tva9AmtCt: 2700, tva19BaseCt: 50000, tva19AmtCt: 9500, paymentMethod: 'ESPECES', amountTtcCt: 90000 },
      { totalHtCt: 20000, totalTvaCt: 0, totalTimbreCt: 200, totalTtcCt: 20200, tva0BaseCt: 0, tva9BaseCt: 0, tva9AmtCt: 0, tva19BaseCt: 0, tva19AmtCt: 0, paymentMethod: 'CIB', amountTtcCt: 23300 },
    ];
    // 90000+23300 = 113300 ✓ ; timbre 900+200 = 1100 ✓
    assert.deepEqual(crossCheckLedger(a, lines, 5000), []);
    const edited = lines.map((l, i) => (i === 0 ? { ...l, totalTtcCt: l.totalTtcCt + 500 } : l));
    const mism = crossCheckLedger(a, edited, 5000);
    assert.ok(mism.includes('totalTtcCt'), JSON.stringify(mism));
    assert.ok(!mism.includes('especesGrossCt'), JSON.stringify(mism));
  });
});
