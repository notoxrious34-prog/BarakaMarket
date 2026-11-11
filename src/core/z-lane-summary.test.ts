import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDailyZ, zListNative, fetchLossesWindow } from './fiscal-authority';

// P0b regression (AUDIT-2026-11-11 HIGH): the Z lane must hydrate from the
// lane in BOTH lanes — never assert context-memory zeros as ledger truth.
const SUMMARY = {
  date: '2026-11-11', sales_count: 2, total_ht_ct: 98028, total_tva_ct: 2972,
  total_timbre_ct: 1000, total_ttc_ct: 102000, total_especes_ct: 37000,
  total_bank_ct: 65000, total_credit_granted_ct: 0,
};

describe('fetchDailyZ loopback parity (P0b)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('falls back to /api/z/summary outside Tauri (was: null → fake zeros)', async () => {
    let hitUrl = '';
    globalThis.fetch = (async (url: unknown) => {
      hitUrl = String(url);
      return { ok: true, json: async () => SUMMARY };
    }) as typeof fetch;
    const z = await fetchDailyZ('2026-11-11');
    assert.ok(z, 'must hydrate from loopback, not null');
    assert.equal(z!.sales_count, 2);
    assert.equal(z!.total_ttc_ct, 102000);
    assert.match(hitUrl, /\/api\/z\/summary\?date=2026-11-11/);
  });

  it('stays null (honest not-loaded) when the lane is down — never zero', async () => {
    globalThis.fetch = (async () => { throw new Error('down'); }) as typeof fetch;
    assert.equal(await fetchDailyZ('2026-11-11'), null);
  });
});

describe('zListNative + fetchLossesWindow loopback parity (P0d)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('zListNative falls back to /api/z/list outside Tauri', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify([{ day: '2026-11-01', close_kind: 'DAY', report_number: 'Z-2026-000001' }]),
        { status: 200 },
      )) as typeof fetch;
    const z = await zListNative();
    assert.ok(z && z.rows.length === 1 && z.rows[0]['report_number'] === 'Z-2026-000001');
  });

  it('fetchLossesWindow returns [] when the lane is down (never throws)', async () => {
    globalThis.fetch = (async () => { throw new Error('down'); }) as typeof fetch;
    assert.deepEqual(await fetchLossesWindow('a', 'b'), []);
  });
});
