import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { commitSale, commitSettlement, commitVoid, backupDatabase, fetchDailyZ, mintRowId } from './fiscal-authority.js';

/**
 * T4b (ADR-026): the native-first commit lane.
 * - Outside Tauri it must fall back to the loopback POST (stubbed fetch).
 * - The minted row id must travel in the POST body (shared identity).
 * - Loopback down => null (the caller queues provisional + outbox).
 */
describe('commit lane (T4b)', () => {
  it('mintRowId returns unique non-empty ids', () => {
    const a = mintRowId();
    const b = mintRowId();
    assert.ok(a.length > 0 && b.length > 0 && a !== b);
  });

  it('commitSale falls back to loopback and forwards the minted id', async () => {
    let seenBody = '';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      seenBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({ id: 'rid', invoice_number: 'FACT-2026-000001', ticket_number: 'T-2026-000001' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const out = await commitSale(
        {
          cashier_id: 'C-01', cashier_name: 'Amine', payment_method: 'ESPECES',
          amount_paid_ct: 179400, amount_returned_ct: 0,
          totals: {
            total_ht_ct: 165528, total_tva_ct: 12072, timbre_ct: 1800, total_ttc_ct: 179400,
            tva_breakdown: {
              0: { base_ht_ct: 65000, tva_amount_ct: 0, total_ttc_ct: 65000 },
              9: { base_ht_ct: 70276, tva_amount_ct: 6324, total_ttc_ct: 76600 },
              19: { base_ht_ct: 30252, tva_amount_ct: 5748, total_ttc_ct: 36000 },
            },
          },
        },
        [],
      );
      assert.deepEqual(out, { id: 'rid', invoice_number: 'FACT-2026-000001', ticket_number: 'T-2026-000001' });
      const body = JSON.parse(seenBody) as { header: { id?: string } };
      assert.ok(body.header.id && body.header.id.length > 0, 'minted id must travel in the POST body');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('commitSettlement falls back to loopback', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ id: 'sid', receipt_number: 'Q-2026-000001' }), { status: 200 });
    }) as typeof fetch;
    try {
      const out = await commitSettlement({
        client_id: 1, amount_ct: 100000, payment_method: 'ESPECES',
        timbre_ct: 1000, total_collected_ct: 101000,
      });
      assert.deepEqual(out, { id: 'sid', receipt_number: 'Q-2026-000001' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('loopback down => null (provisional + outbox path)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    try {
      const out = await commitSale(
        {
          cashier_id: 'C-01', cashier_name: 'Amine', payment_method: 'ESPECES',
          amount_paid_ct: 0, amount_returned_ct: 0,
          totals: {
            total_ht_ct: 0, total_tva_ct: 0, timbre_ct: 0, total_ttc_ct: 0,
            tva_breakdown: {
              0: { base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
              9: { base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
              19: { base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 },
            },
          },
        },
        [],
      );
      assert.equal(out, null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('#003: commitVoid falls back to the loopback void endpoint with reason+actor', async () => {
    let seenUrl = '';
    let seenBody = '';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      seenUrl = String(url);
      seenBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    try {
      const out = await commitVoid('sale-1', 'wrong item scanned', 'owner');
      assert.deepEqual(out, { id: 'sale-1', status: 'CANCELLED' });
      assert.ok(seenUrl.endsWith('/api/sales/sale-1/void'), 'must hit the per-sale void endpoint');
      const body = JSON.parse(seenBody) as { reason?: string; by?: string };
      assert.equal(body.reason, 'wrong item scanned');
      assert.equal(body.by, 'owner');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('#003: commitVoid down => null (legal journal is never faked)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    try {
      assert.equal(await commitVoid('sale-1', 'reason', 'owner'), null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('#003: backupDatabase falls back to the loopback backup endpoint', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ok: true, dest: '/abs/baraka-2026.db' }), { status: 200 });
    }) as typeof fetch;
    try {
      const out = await backupDatabase('data/baraka-2026.db');
      assert.equal(out?.path, '/abs/baraka-2026.db');
      assert.equal(out?.bytes, null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('#003: fetchDailyZ is native-only (browser lane returns null, no fetch)', async () => {
    const realFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => { called = true; throw new Error('must not fetch'); }) as typeof fetch;
    try {
      assert.equal(await fetchDailyZ('2026-11-01'), null);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
