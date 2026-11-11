import type { ReturnHead } from './returns-authority';
import type { ClaimHead, QuarantineRow } from './claims-authority';

/**
 * ADR-045 — returns health kernel (pure): day-desk counters for the health
 * strip. No lane, no dates, no side effects — status tallies only.
 */
export interface ReturnsHealth {
  drafts: number;
  approved: number;
  quarantined: number;
  openClaims: number;
}

export function computeReturnsHealth(
  rows: Pick<ReturnHead, 'status'>[],
  quar: QuarantineRow[],
  claims: Pick<ClaimHead, 'status'>[],
): ReturnsHealth {
  let drafts = 0;
  let approved = 0;
  for (const r of rows) {
    if (r.status === 'DRAFT') drafts++;
    else if (r.status === 'APPROVED') approved++;
  }
  let openClaims = 0;
  for (const c of claims) if (c.status === 'OPEN') openClaims++;
  return { drafts, approved, quarantined: quar.length, openClaims };
}
