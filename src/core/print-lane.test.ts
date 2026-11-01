import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toHex, spoolRawBytes, showPoleTotal, printSaleAuto } from './print-lane.js';
import type { Sale } from '../types/index.js';

/** T5 (ADR-028): unified print lane — spool contract + Lane B fallback. */
describe('print lane (T5)', () => {
  it('toHex encodes bytes deterministically', () => {
    assert.equal(toHex(new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa])), '1b700019fa');
  });

  it('spoolRawBytes POSTs hex + label and returns accepted bytes', async () => {
    let seen: { url?: string; body?: string } = {};
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      seen = { url: String(url), body: String(init?.body ?? '') };
      return new Response(JSON.stringify({ ok: true, bytes: 5, spool: 'raw-print-spool.bin' }), { status: 200 });
    }) as typeof fetch;
    try {
      const n = await spoolRawBytes(new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]), 'drawer-kick');
      assert.equal(n, 5);
      assert.ok(seen.url?.endsWith('/api/raw-print'));
      const body = JSON.parse(seen.body ?? '{}') as { hex?: string; label?: string };
      assert.equal(body.hex, '1b700019fa');
      assert.equal(body.label, 'drawer-kick');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('pole frames spool under the pole-display label', async () => {
    let label = '';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      label = (JSON.parse(String(init?.body ?? '{}')) as { label?: string }).label ?? '';
      return new Response(JSON.stringify({ ok: true, bytes: 46, spool: 'pole-display-spool.bin' }), { status: 200 });
    }) as typeof fetch;
    try {
      assert.equal(await showPoleTotal(1794), true);
      assert.equal(label, 'pole-display');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('loopback down => null/false (Lane B stays the path, never throws)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    try {
      assert.equal(await spoolRawBytes(new Uint8Array([1, 2]), 'x'), null);
      assert.equal(await showPoleTotal(10), false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('printSaleAuto spools the full ticket buffer (kick on ESPECES)', async () => {
    let hexLen = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { hex?: string };
      hexLen = (body.hex ?? '').length / 2;
      return new Response(JSON.stringify({ ok: true, bytes: hexLen }), { status: 200 });
    }) as typeof fetch;
    const sale = {
      invoice_number: 'FACT-2026-000001', ticket_number: 'T-2026-000001',
      created_at: '2026-11-01T12:00:00.000Z', cashier_name: 'Amine',
      items: [{ name_fr: 'LAIT', name_ar: '', quantity: 1, unit: 'PIECE', total_line_ttc: 180 }],
      total_ht: 165.03, tva_breakdown: {
        0: { base_ht: 0, tva_amount: 0 }, 9: { base_ht: 165.03, tva_amount: 14.85 }, 19: { base_ht: 0, tva_amount: 0 },
      },
      timbre_fiscal: 0, total_ttc: 179.88, payment_method: 'ESPECES',
      amount_paid: 200, amount_returned: 20.12,
    } as unknown as Sale;
    try {
      assert.equal(await printSaleAuto(sale, { store_name: 'BARAKA' }), true);
      assert.ok(hexLen > 200, `ticket buffer should be substantial (got ${hexLen}B)`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
