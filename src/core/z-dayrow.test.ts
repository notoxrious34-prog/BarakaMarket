import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapStoredDayRow } from './z-dayrow';

// MKT-009 regression (AUDIT MED): day-reprint must map the stored DAY row
// field-for-field. Fails before the extractor exists; guards the mapping
// against future column renames (a silent NaN here reprints a false Z).
describe('z-dayrow (MKT-009)', () => {
  const row = {
    total_sales_count: 2, total_ht_ct: 100000, tva0_base_ct: 50000,
    tva9_base_ct: 30000, tva9_amt_ct: 2700, tva19_base_ct: 20000,
    tva19_amt_ct: 3800, total_tva_ct: 6500, total_timbre_ct: 360,
    total_ttc_ct: 106860, especes_gross_ct: 70000, cib_total_ct: 30000,
    dahabiya_total_ct: 6860, credit_granted_ct: 0, credit_collected_ct: 5000,
    first_invoice_number: 'FACT-2026-000001', last_invoice_number: 'FACT-2026-000002',
  };
  it('maps every fiscal field of a stored DAY row', () => {
    const v = mapStoredDayRow(row);
    assert.equal(v.salesCount, 2);
    assert.equal(v.ttc, 106860);
    assert.equal(v.bank, 36860);
    assert.equal(v.first, 'FACT-2026-000001');
    assert.equal(v.last, 'FACT-2026-000002');
    assert.equal(v.tva, 6500);
  });
  it('never yields NaN on partial/corrupt rows (0 instead)', () => {
    const v = mapStoredDayRow({ total_ttc_ct: undefined } as never);
    for (const k of ['salesCount', 'ht', 'tva', 'ttc', 'esp', 'bank'] as const) {
      assert.ok(Number.isFinite(v[k]), k);
    }
  });
});
