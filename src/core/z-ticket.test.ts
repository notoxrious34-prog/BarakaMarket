/**
 * z-ticket tests (Z-lane): the byte-identical contract.
 * The printed ticket and the reprint from the stored row MUST be the same
 * string for the same row — this golden locks that, plus the Z2/Z6 display
 * rule (stored hash when closed, provisional preview when open).
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildZTicketText, type ZTicketData } from './z-ticket';
import { computeZHash, GENESIS_PREV_HASH, previewChainHash } from './zreport';

const row: ZTicketData = {
  storeName: 'BARAKA MARKET', owner: 'Gérant', address: 'Alger',
  rc: '16/00-1234567', nif: '000216003456789', nis: '1234567', ai: '1234567',
  reportNumber: 'Z-2026-000041', date: '2026-11-04', closingTime: '21:30:00',
  firstInvoice: 'FACT-2026-000101', lastInvoice: 'FACT-2026-000142',
  salesCount: 42,
  totalHtCt: 100000, tva0BaseCt: 20000, tva9BaseCt: 0, tva9AmtCt: 0,
  tva19BaseCt: 80000, tva19AmtCt: 15200,
  totalTvaCt: 15200, totalTimbreCt: 1800, totalTtcCt: 117000,
  especesGrossCt: 90000, bankTotalCt: 20000,
  creditGrantedCt: 7000, creditCollectedCt: 5050,
  prevHash: GENESIS_PREV_HASH,
  hash: computeZHash(GENESIS_PREV_HASH, 'Z-2026-000041', '2026-11-04', 117000, 1800),
  finalized: true,
};

describe('z-ticket (Z-lane)', () => {
  it('byte-identical golden: same row in, same string out', () => {
    const a = buildZTicketText(row);
    const b = buildZTicketText({ ...row });
    assert.strictEqual(a, b);
    assert.match(a, /\*\*\* RAPPORT Z DE CAISSE \*\*\*/);
    assert.match(a, /TOTAL TTC: 1170\.00 DZD/);
    assert.match(a, /Timbre Fiscal \(Especes\): 18\.00 DZD/);
    assert.match(a, /hash: [0-9a-f]{64}/);
  });
  it('finalized flag prints FINALISE; draft omits it', () => {
    assert.match(buildZTicketText(row), /FINALISE/);
    assert.ok(!buildZTicketText({ ...row, finalized: false }).includes('FINALISE'));
  });
  it('Z2/Z6: closed shows the stored hash; open previews over the shown number', () => {
    const closed = previewChainHash({
      closureHash: 'ab'.repeat(32), prevHash: GENESIS_PREV_HASH,
      reportNumber: 'Z-2026-000041', date: '2026-11-04',
      totalTtcCt: 117000, totalTimbreCt: 1800,
    });
    assert.equal(closed.hash, 'ab'.repeat(32));
    assert.equal(closed.provisional, false);
    const open = previewChainHash({
      closureHash: null, prevHash: GENESIS_PREV_HASH,
      reportNumber: 'Z-20261104-01', date: '2026-11-04',
      totalTtcCt: 117000, totalTimbreCt: 1800,
    });
    assert.equal(open.provisional, true);
    assert.equal(open.hash, computeZHash(GENESIS_PREV_HASH, 'Z-20261104-01', '2026-11-04', 117000, 1800));
  });
});
