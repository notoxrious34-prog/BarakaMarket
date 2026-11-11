/**
 * z-dayrow.ts — MKT-009 (AUDIT MED: no day navigation).
 *
 * Pure mapping from a stored DAY registry row (centimes, as returned by
 * zListNative) to the ticket values the Z view reprints. Extracted from
 * DailyZReportView so the reprint path has a regression contract: every
 * fiscal field mapped, never NaN (partial rows degrade to 0, never a
 * blank/false Z).
 */

/** Ticket values sourced from a stored DAY row (all money in centimes). */
export interface StoredDayValues {
  salesCount: number; ht: number; b0: number; b9: number; a9: number;
  b19: number; a19: number; tva: number; timbre: number; ttc: number;
  esp: number; bank: number; cred: number; coll: number;
  first: string; last: string;
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Map a raw stored DAY row to reprint values (NaN-proof). */
export function mapStoredDayRow(day: Record<string, unknown>): StoredDayValues {
  return {
    salesCount: n(day.total_sales_count),
    ht: n(day.total_ht_ct), b0: n(day.tva0_base_ct),
    b9: n(day.tva9_base_ct), a9: n(day.tva9_amt_ct),
    b19: n(day.tva19_base_ct), a19: n(day.tva19_amt_ct),
    tva: n(day.total_tva_ct), timbre: n(day.total_timbre_ct),
    ttc: n(day.total_ttc_ct), esp: n(day.especes_gross_ct),
    bank: n(day.cib_total_ct) + n(day.dahabiya_total_ct),
    cred: n(day.credit_granted_ct), coll: n(day.credit_collected_ct),
    first: String(day.first_invoice_number ?? ''),
    last: String(day.last_invoice_number ?? ''),
  };
}
