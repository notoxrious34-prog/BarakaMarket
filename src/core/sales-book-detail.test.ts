import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detailToSale } from './sales-book-detail';

// MKT-007 regression: detailToSale (moved verbatim from SalesBookView)
// must map the fiscal head + lines to printable DZD units exactly.
// Fails before the module exists.
describe('sales-book-detail (MKT-007)', () => {
  const d = {
    head: {
      id: 'S1', invoice_number: 'FACT-2026-000002', ticket_number: 'T-2026-000002',
      cashier_id: 'u1', cashier_name: 'Amine', client_id: null, client_name: null,
      total_ht_ct: 100000, tva0_base_ct: 0, tva0_amt_ct: 0, tva0_ttc_ct: 0,
      tva9_base_ct: 30000, tva9_amt_ct: 2700, tva9_ttc_ct: 32700,
      tva19_base_ct: 0, tva19_amt_ct: 0, tva19_ttc_ct: 0,
      total_tva_ct: 2700, timbre_ct: 360, total_ttc_ct: 103060,
      payment_method: 'ESPECES', amount_paid_ct: 103060, amount_returned_ct: 0,
      status: 'COMPLETED', created_at: '2026-11-11T10:00:00',
      tva_enabled: 1, timbre_enabled: 1,
    },
    items: [{
      sale_item_id: 'L1', product_id: 7, barcode: '6111250000013',
      name_fr: 'LAIT CONDENSE', name_ar: 'حليب مركز',
      unit_price_ct: 50000, qty_milli: 2000, unit: 'PIECE', tva_rate: 9,
      line_ttc_ct: 103060, returned_milli: 0, remaining_milli: 2000,
    }],
  };
  it('maps head cents to DZD units with regime flags', () => {
    const s = detailToSale(d as never);
    assert.equal(s.invoice_number, 'FACT-2026-000002');
    assert.equal(s.total_ttc, 1030.6);
    assert.equal(s.timbre_fiscal, 3.6);
    assert.deepEqual(s.fiscal_regime, { tva_enabled: true, timbre_enabled: true });
    assert.equal(s.client_id, undefined);
  });
  it('maps lines with milli quantities', () => {
    const s = detailToSale(d as never);
    assert.equal(s.items.length, 1);
    assert.equal(s.items[0].quantity, 2);
    assert.equal(s.items[0].unit_price_ttc, 500);
    assert.equal(s.items[0].total_line_ttc, 1030.6);
  });
});
