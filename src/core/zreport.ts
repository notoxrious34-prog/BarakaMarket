/**
 * Baraka Market — Fiscal Z-report chain engine (Gate-03 TASK 1).
 * Tamper-evident daily closures: Hash_n = SHA256(prev || number || date ||
 * totalTtcCt || totalTimbreCt). All money in integer centimes — no floats.
 *
 * @module core/zreport
 */
import { sha256Hex } from './sha256';

/** Genesis previous-hash: 64 zeros. */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/** Z-YYYY-XXXXXX — zero-padded monotonic, minimum 6 digits. */
export function formatZNumber(year: number, n: number): string {
  return `Z-${year}-${String(n).padStart(6, '0')}`;
}

export interface ZAggregatesCt {
  salesCount: number;
  totalHtCt: number;
  tva0BaseCt: number;
  tva9BaseCt: number;
  tva9AmtCt: number;
  tva19BaseCt: number;
  tva19AmtCt: number;
  totalTvaCt: number;
  totalTimbreCt: number;
  totalTtcCt: number;
  especesGrossCt: number;
  cibTotalCt: number;
  dahabiyaTotalCt: number;
  creditGrantedCt: number;
  creditCollectedCt: number;
  firstInvoice: string;
  lastInvoice: string;
}

export interface ZReport extends ZAggregatesCt {
  reportNumber: string;
  date: string;
  openingTime: string;
  closingTime: string;
  prevHash: string;
  hash: string;
}

/** Deterministic chain hash over the canonical field join. */
export function computeZHash(
  prevHash: string,
  reportNumber: string,
  date: string,
  totalTtcCt: number,
  totalTimbreCt: number,
): string {
  return sha256Hex(`${prevHash}||${reportNumber}||${date}||${totalTtcCt}||${totalTimbreCt}`);
}

/** Finalize a closure: attaches prev/hash around caller-supplied aggregates. */
export function finalizeZReport(
  meta: { reportNumber: string; date: string; openingTime: string; closingTime: string; prevHash: string },
  agg: ZAggregatesCt,
): ZReport {
  const hash = computeZHash(meta.prevHash, meta.reportNumber, meta.date, agg.totalTtcCt, agg.totalTimbreCt);
  return { ...agg, ...meta, hash };
}

/** Verify an ordered chain: link integrity + per-report hash recomputation. */
export function verifyZChain(reports: ZReport[]): { ok: boolean; failedAt: string | null } {
  let prev = GENESIS_PREV_HASH;
  for (const r of reports) {
    if (r.prevHash !== prev) return { ok: false, failedAt: r.reportNumber };
    const recomputed = computeZHash(r.prevHash, r.reportNumber, r.date, r.totalTtcCt, r.totalTimbreCt);
    if (recomputed !== r.hash) return { ok: false, failedAt: r.reportNumber };
    prev = r.hash;
  }
  return { ok: true, failedAt: null };
}

export interface LedgerLine {
  totalHtCt: number;
  totalTvaCt: number;
  totalTimbreCt: number;
  totalTtcCt: number;
  tva0BaseCt: number;
  tva9BaseCt: number;
  tva9AmtCt: number;
  tva19BaseCt: number;
  tva19AmtCt: number;
  paymentMethod: string;
  amountTtcCt: number;
}

/**
 * Ledger cross-check: recompute aggregates from raw sale lines and compare
 * field-by-field. Any post-closure tampering (edited line, deleted sale)
 * surfaces as a named mismatch list.
 */
export function crossCheckLedger(
  report: ZAggregatesCt,
  lines: LedgerLine[],
  creditCollectedCt: number,
): string[] {
  const acc: ZAggregatesCt = {
    salesCount: lines.length,
    totalHtCt: 0, tva0BaseCt: 0, tva9BaseCt: 0, tva9AmtCt: 0,
    tva19BaseCt: 0, tva19AmtCt: 0, totalTvaCt: 0, totalTimbreCt: 0,
    totalTtcCt: 0, especesGrossCt: 0, cibTotalCt: 0, dahabiyaTotalCt: 0,
    creditGrantedCt: 0, creditCollectedCt,
    firstInvoice: report.firstInvoice, lastInvoice: report.lastInvoice,
  };
  for (const l of lines) {
    acc.totalHtCt += l.totalHtCt; acc.totalTvaCt += l.totalTvaCt;
    acc.totalTimbreCt += l.totalTimbreCt; acc.totalTtcCt += l.totalTtcCt;
    acc.tva0BaseCt += l.tva0BaseCt; acc.tva9BaseCt += l.tva9BaseCt;
    acc.tva9AmtCt += l.tva9AmtCt; acc.tva19BaseCt += l.tva19BaseCt;
    acc.tva19AmtCt += l.tva19AmtCt;
    if (l.paymentMethod === 'ESPECES') acc.especesGrossCt += l.amountTtcCt;
    else if (l.paymentMethod === 'CIB') acc.cibTotalCt += l.amountTtcCt;
    else if (l.paymentMethod === 'DAHABIYA') acc.dahabiyaTotalCt += l.amountTtcCt;
    else if (l.paymentMethod === 'CREDIT') acc.creditGrantedCt += l.amountTtcCt;
  }
  const fields: (keyof ZAggregatesCt)[] = [
    'salesCount', 'totalHtCt', 'tva0BaseCt', 'tva9BaseCt', 'tva9AmtCt',
    'tva19BaseCt', 'tva19AmtCt', 'totalTvaCt', 'totalTimbreCt', 'totalTtcCt',
    'especesGrossCt', 'cibTotalCt', 'dahabiyaTotalCt', 'creditGrantedCt', 'creditCollectedCt',
  ];
  return fields.filter(f => acc[f] !== report[f]).map(f => String(f));
}

/**
 * Z2/Z6-fix (v1.4.5): ONE rule for the hash the ticket shows.
 * Closed  → the stored server hash (never recomputed client-side).
 * Open    → an explicitly provisional preview over the DISPLAYED number,
 *           so the hash always matches the number printed above it.
 */
export function previewChainHash(input: {
  closureHash: string | null;
  prevHash: string;
  reportNumber: string;
  date: string;
  totalTtcCt: number;
  totalTimbreCt: number;
}): { hash: string; provisional: boolean } {
  if (input.closureHash) return { hash: input.closureHash, provisional: false };
  return {
    hash: computeZHash(
      input.prevHash, input.reportNumber, input.date,
      input.totalTtcCt, input.totalTimbreCt,
    ),
    provisional: true,
  };
}
