/**
 * till-outcome.ts — MKT-008 (AUDIT-2026-11-11 Minor).
 *
 * A till movement attempt has THREE honest outcomes, never a boolean:
 * - 'posted'     — cash left the drawer through the till lane.
 * - 'no-session'  — no cash session open: genuinely hors-caisse.
 * - 'lane-down'   — the till lane is unreachable here: the movement did NOT
 *                   post, and the UI must say so (the old `false` lied
 *                   "hors-caisse" while the journal debited 530000 Caisse).
 */

/** Three-state till movement outcome (ledger vocabulary). */
export type TillOutcome = 'posted' | 'no-session' | 'lane-down';

/** Ledger semantics: only a posted movement counts as till cash. */
export function isTillPosted(outcome: TillOutcome): boolean {
  return outcome === 'posted';
}

/** Cashier-facing sentence for a till outcome (AR/FR). */
export function tillOutcomeLabel(outcome: TillOutcome, isAr: boolean): string {
  switch (outcome) {
    case 'posted':
      return isAr ? 'خرج من الصندوق ✓' : 'till ✓';
    case 'no-session':
      return isAr ? 'خارج الصندوق' : 'hors-caisse';
    case 'lane-down':
      return isAr
        ? 'سُجل دون حركة صندوق — المسار غائب (راجع الجلسة)'
        : 'Enregistré sans mouvement de caisse — voie absente (voir session)';
  }
}
