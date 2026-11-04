/**
 * client-debt.ts — pure kernel of the Carnet de Dette (D-lane, institutional audit).
 *
 * Every money rule of the debts page lives here so it can be unit-tested
 * without React: settlement guards, void reversal, ceiling sanity, NIF
 * optionality, and the statement opening-balance reconciliation.
 */
import { isValidNIF } from './supplier-finance';

export { isValidNIF };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * D1-fix: a settlement must be a strictly positive, finite amount that never
 * exceeds the live balance. The UI caps `max={balance}`, but the context is
 * the last line of defence (programmatic calls, stale modals, outbox paths).
 */
export function validateSettlementAmount(amount: number, balance: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('[settle] amount must be strictly positive');
  }
  if (amount - balance > 0.005) {
    throw new Error('[settle] amount exceeds the outstanding balance — use a partial payment');
  }
}

/**
 * D3-fix: voiding a CREDIT sale must give the debt back. Pure counterpart of
 * the balance increment done at credit-sale time (same rounding, floor 0).
 */
export function reverseCreditOnVoid(balance: number, saleTotal: number): number {
  return Math.max(0, round2(balance - saleTotal));
}

/**
 * D7-fix: 0 means unlimited (POS gate `max_credit_limit > 0`), negatives used
 * to slip through and silently disable the gate. Refused, not clamped —
 * the cashier must see the mistake.
 */
export function validateCreditLimit(limit: number): void {
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error('[client] credit ceiling must be >= 0 (0 = unlimited)');
  }
}

/**
 * D12-fix: the statement is event-sourced from visible sales/settlements, so
 * seeded or historical debt is invisible to it. The honest presentation is an
 * explicit opening row: current header balance minus the ledger net.
 */
export function openingBalanceDzd(creditBalance: number, ledgerNet: number): number {
  return round2(creditBalance - ledgerNet);
}
