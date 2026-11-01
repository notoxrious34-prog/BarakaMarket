/**
 * Baraka Market — Unified print lane (T5, ADR-028).
 * One entry point for every fiscal print:
 *   Lane A (hardware): compiled ESC/POS bytes -> loopback spool file
 *     (a USB/COM forwarder drains it; printer vs pole split by label).
 *   Lane B (instant): the caller keeps the buffer for CSS window.print
 *     or .bin download — Lane A failure NEVER blocks the sale.
 *
 * All functions are fire-and-forget safe: they resolve false/null when
 * the loopback is absent instead of throwing.
 *
 * @module core/print-lane
 */
import { buildReceipt, type EscPosSale } from '../hardware/escpos.js';
import { buildPoleTotal, buildPoleTendered, buildPoleThanks, buildPoleWelcome } from '../hardware/pole-display.js';
import { LOOPBACK_BASE, getLoopbackToken } from './fiscal-authority.js';
import type { Sale } from '../types/index.js';

export function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Spool raw bytes to the shop forwarder. Returns bytes accepted or null. */
export async function spoolRawBytes(buf: Uint8Array, label: string): Promise<number | null> {
  try {
    const token = await getLoopbackToken();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${LOOPBACK_BASE}/api/raw-print`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-baraka-loopback': token } : {}),
      },
      body: JSON.stringify({ hex: toHex(buf), label }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = (await r.json()) as { bytes?: number };
    return typeof j.bytes === 'number' ? j.bytes : null;
  } catch {
    return null;
  }
}

function saleToEscPos(sale: Sale, store: { store_name: string; rc_number?: string; nif_number?: string }, isAr: boolean, kickDrawer: boolean): { buf: Uint8Array; kick: boolean } {
  const buf = buildReceipt(
    {
      storeName: store.store_name,
      rc: store.rc_number,
      nif: store.nif_number,
      invoice: sale.invoice_number,
      ticket: sale.ticket_number,
      date: sale.created_at,
      cashier: sale.cashier_name,
      items: sale.items.map((it) => ({
        name: isAr ? it.name_ar || it.name_fr : it.name_fr,
        qty: it.quantity,
        unit: it.unit,
        lineTtc: it.total_line_ttc,
      })),
      totalHt: sale.total_ht,
      tva9Base: sale.tva_breakdown[9].base_ht,
      tva9Amt: sale.tva_breakdown[9].tva_amount,
      tva19Base: sale.tva_breakdown[19].base_ht,
      tva19Amt: sale.tva_breakdown[19].tva_amount,
      timbre: sale.timbre_fiscal,
      totalTtc: sale.total_ttc,
      paymentMethod: sale.payment_method,
      amountPaid: sale.amount_paid,
      changeDue: sale.amount_returned,
    } satisfies EscPosSale,
    { kickDrawer },
  );
  return { buf, kick: kickDrawer };
}

/**
 * Auto-spool the fiscal ticket after an authoritative commit (Lane A).
 * Drawer kicks on ESPECES only. Resolves true when the spool accepted the
 * buffer; false leaves Lane B (CSS modal print) as the path — never throws.
 */
export async function printSaleAuto(
  sale: Sale,
  store: { store_name: string; rc_number?: string; nif_number?: string },
  isAr = false,
): Promise<boolean> {
  const { buf } = saleToEscPos(sale, store, isAr, sale.payment_method === 'ESPECES');
  const n = await spoolRawBytes(buf, `ticket-${sale.ticket_number}`);
  return typeof n === 'number' && n === buf.length;
}

/** Pole: amount due (shown when the payment modal opens). */
export async function showPoleTotal(totalTtc: number): Promise<boolean> {
  const n = await spoolRawBytes(buildPoleTotal(totalTtc), 'pole-display');
  return n !== null;
}

/** Pole: tendered + change/thanks (shown on commit). */
export async function showPoleTendered(paid: number, change: number, method: string): Promise<boolean> {
  const n = await spoolRawBytes(buildPoleTendered(paid, change, method), 'pole-display');
  return n !== null;
}

/** Pole: welcome / thanks idle frames. */
export async function showPoleWelcome(storeName: string): Promise<boolean> {
  const n = await spoolRawBytes(buildPoleWelcome(storeName), 'pole-display');
  return n !== null;
}

export async function showPoleThanks(): Promise<boolean> {
  const n = await spoolRawBytes(buildPoleThanks(), 'pole-display');
  return n !== null;
}
