/**
 * Baraka Market — Canonical Z-ticket text (Gate #004).
 * Byte-identical rendering of a finalized Z row: the printed ticket and the
 * reprint from the stored record are the SAME string when fed the same row.
 * All money in integer centimes — the only float is the final /100 display.
 *
 * @module core/z-ticket
 */

export interface ZTicketData {
  storeName: string; owner: string; address: string;
  rc: string; nif: string; nis: string; ai: string;
  reportNumber: string; date: string; closingTime: string;
  firstInvoice: string; lastInvoice: string;
  salesCount: number;
  totalHtCt: number;
  tva0BaseCt: number; tva9BaseCt: number; tva9AmtCt: number;
  tva19BaseCt: number; tva19AmtCt: number;
  totalTvaCt: number; totalTimbreCt: number; totalTtcCt: number;
  especesGrossCt: number; bankTotalCt: number;
  creditGrantedCt: number; creditCollectedCt: number;
  prevHash: string; hash: string; finalized: boolean;
}

const dz = (ct: number): string => `${(ct / 100).toFixed(2)} DZD`;
const line = (label: string, value: string): string => `${label}: ${value}`;

/** Deterministic 80mm ticket text for one finalized Z row. */
export function buildZTicketText(d: ZTicketData): string {
  const rows = [
    '*** RAPPORT Z DE CAISSE ***',
    'CLOTURE JOURNALIERE FISCALE',
    `${d.reportNumber}${d.finalized ? ' - FINALISE' : ''}`,
    line('Date', `${d.date} - ${d.closingTime}`),
    `${d.firstInvoice} -> ${d.lastInvoice}`,
    '---',
    line('Nombre de Ventes', String(d.salesCount)),
    line('Total HT', dz(d.totalHtCt)),
    line('TVA 0% (Base)', dz(d.tva0BaseCt)),
    line(`TVA 9% (Base ${dz(d.tva9BaseCt)})`, dz(d.tva9AmtCt)),
    line(`TVA 19% (Base ${dz(d.tva19BaseCt)})`, dz(d.tva19AmtCt)),
    line('Total TVA', dz(d.totalTvaCt)),
    line('Timbre Fiscal (Especes)', dz(d.totalTimbreCt)),
    line('TOTAL TTC', dz(d.totalTtcCt)),
    '---',
    line('Especes', dz(d.especesGrossCt)),
    line('CIB / Dahabiya', dz(d.bankTotalCt)),
    line('Credit accorde', dz(d.creditGrantedCt)),
    line('Credit recouvre', dz(d.creditCollectedCt)),
    '---',
    line('prev', d.prevHash),
    line('hash', d.hash),
    `RC: ${d.rc} | NIF: ${d.nif} | NIS: ${d.nis} | AI: ${d.ai}`,
    d.storeName,
  ];
  return rows.join('\n');
}
