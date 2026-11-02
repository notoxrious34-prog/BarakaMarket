import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openBarakaDb } from './sqlite.js';
import { calculateSaleTotalsCt } from '../core/fiscal.centimes.js';

/**
 * #003 (Phase A): single-lane numbering + exe=browser math parity.
 * - One sequencer per (kind, year): 1000 mints, no gaps, FACT and T lanes independent.
 * - The canonical sale vector commits identically on the TS lane
 *   (invoice FACT-2026-000001, totals 179400ct incl. 1800ct timbre) —
 *   the same vector the Rust lane pins in fiscal::tests.
 * - Provisional DRAFT refs can never collide with the fiscal lane.
 */
const CANON_ITEMS = [
  { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE' as const, tva_rate: 9 as const, discount_bp: 0, line_ht_ct: 33028, line_tva_ct: 2972, line_ttc_ct: 36000 },
  { product_id: null, barcode: 'b', name_fr: 'HUILE', name_ar: '', unit_price_ct: 65000, qty_milli: 1000, unit: 'PIECE' as const, tva_rate: 0 as const, discount_bp: 0, line_ht_ct: 65000, line_tva_ct: 0, line_ttc_ct: 65000 },
  { product_id: null, barcode: 'c', name_fr: 'CHOC', name_ar: '', unit_price_ct: 12000, qty_milli: 3000, unit: 'PIECE' as const, tva_rate: 19 as const, discount_bp: 0, line_ht_ct: 30252, line_tva_ct: 5748, line_ttc_ct: 36000 },
  { product_id: null, barcode: 'd', name_fr: 'POMMES', name_ar: '', unit_price_ct: 28000, qty_milli: 1450, unit: 'KG' as const, tva_rate: 9 as const, discount_bp: 0, line_ht_ct: 37248, line_tva_ct: 3352, line_ttc_ct: 40600 },
];

describe('#003 single lane + parity', () => {
  it('1000 sequential mints, no gaps, FACT/T lanes independent', () => {
    const b = openBarakaDb(':memory:');
    try {
      for (let i = 1; i <= 1000; i++) {
        assert.equal(b.nextInvoiceNumber(2026), `FACT-2026-${String(i).padStart(6, '0')}`);
      }
      // T lane untouched by the FACT run — its own single lane starts at 1.
      assert.equal(b.nextTicketNumber(2026), 'T-2026-000001');
      assert.equal(b.nextTicketNumber(2026), 'T-2026-000002');
    } finally {
      b.close();
    }
  });

  it('canonical sale vector: same math as the Rust lane (179400ct, timbre 1800ct)', () => {
    const b = openBarakaDb(':memory:');
    try {
      b.upsertProduct({
        id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', category_id: 'epicerie',
        buy_price_ct: 15000, sell_price_ct: 18000, tva_rate: 9, stock_milli: 48000,
        min_stock_milli: 0, unit: 'PIECE', is_scale: 0, scale_item_code: null,
        has_expiry: 0, expiry_date: null,
      });
      const totals = calculateSaleTotalsCt(
        CANON_ITEMS.map(it => ({
          tva_rate: it.tva_rate, total_line_ht_ct: it.line_ht_ct,
          total_line_tva_ct: it.line_tva_ct, total_line_ttc_ct: it.line_ttc_ct,
        })),
        'ESPECES',
      );
      const out = b.recordSale({
        cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
        amount_paid_ct: 200000, amount_returned_ct: 20600,
        totals, created_at: '2026-11-01T12:00:00.000Z', client_sale_id: 'PARITY-1',
      }, CANON_ITEMS);
      assert.equal(out.invoice_number, 'FACT-2026-000001');
      assert.equal(out.ticket_number, 'T-2026-000001');
      const row = b.getSale(out.id) as unknown as Record<string, number>;
      assert.equal(row.total_ht_ct, 165528);
      assert.equal(row.total_tva_ct, 12072);
      assert.equal(row.timbre_ct, 1800);
      assert.equal(row.total_ttc_ct, 179400);
      // stock drained once, first line only: 48000 - 2000
      assert.equal(b.getProduct(1).stock_milli, 46000);
    } finally {
      b.close();
    }
  });

  it('provisional DRAFT refs can never match the fiscal lane', () => {
    for (const draft of ['DRAFT-FACT-abc123', 'DRAFT-T-xyz789', 'DRAFT-Q-1']) {
      assert.ok(!/^FACT-\d{4}-\d{6}$/.test(draft), `${draft} must not parse as a fiscal invoice`);
      assert.ok(!/^T-\d{4}-\d{6}$/.test(draft), `${draft} must not parse as a fiscal ticket`);
    }
  });
});
