import type { Sale } from '../types';
import type { SalesBookDetail } from './sales-book-authority';

/**
 * sales-book-detail.ts — MKT-007 (moved verbatim from SalesBookView).
 * Lookup lines + full fiscal head → printable Sale (DZD units).
 */
export function detailToSale(d: SalesBookDetail): Sale {
  const h = d.head;
  const n = (k: string) => Number(h[k] ?? 0);
  return {
    id: String(h.id), invoice_number: String(h.invoice_number), ticket_number: String(h.ticket_number),
    cashier_id: String(h.cashier_id ?? ''), cashier_name: String(h.cashier_name ?? ''),
    client_id: h.client_id == null ? undefined : Number(h.client_id),
    client_name: (h.client_name as string | null) ?? undefined,
    items: d.items.map(it => ({
      product_id: it.product_id ?? 0, barcode: it.barcode, name_fr: it.name_fr, name_ar: it.name_ar,
      unit_price_ttc: it.unit_price_ct / 100, quantity: it.qty_milli / 1000,
      unit: it.unit as 'PIECE' | 'KG' | 'LITRE', tva_rate: it.tva_rate as 0 | 9 | 19,
      discount_percent: 0,
      total_line_ht: 0, total_line_tva: 0, total_line_ttc: it.line_ttc_ct / 100,
    })),
    total_ht: n('total_ht_ct') / 100,
    tva_breakdown: {
      0: { rate: 0 as const, base_ht: n('tva0_base_ct') / 100, tva_amount: n('tva0_amt_ct') / 100, total_ttc: n('tva0_ttc_ct') / 100 },
      9: { rate: 9 as const, base_ht: n('tva9_base_ct') / 100, tva_amount: n('tva9_amt_ct') / 100, total_ttc: n('tva9_ttc_ct') / 100 },
      19: { rate: 19 as const, base_ht: n('tva19_base_ct') / 100, tva_amount: n('tva19_amt_ct') / 100, total_ttc: n('tva19_ttc_ct') / 100 },
    },
    total_tva: n('total_tva_ct') / 100, timbre_fiscal: n('timbre_ct') / 100, total_ttc: n('total_ttc_ct') / 100,
    payment_method: h.payment_method as Sale['payment_method'],
    amount_paid: n('amount_paid_ct') / 100, amount_returned: n('amount_returned_ct') / 100,
    status: h.status as 'COMPLETED' | 'CANCELLED', created_at: String(h.created_at),
    fiscal_regime: { tva_enabled: n('tva_enabled') !== 0, timbre_enabled: n('timbre_enabled') !== 0 },
  };
}
