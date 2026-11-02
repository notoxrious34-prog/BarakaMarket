/**
 * C2 (PLAN-v1.2.0): per-client debt ledger — pure chronological builder.
 * CREDIT purchases (+) vs quittance settlements (−), running balance.
 * Timbre is a fiscal stamp collected ON TOP: memo only, never reduces debt.
 */
import { dzdToCentimes } from './money';

export interface LedgerEvent {
  date: string;
  label: string;
  ref: string;
  debitCt: number;
  creditCt: number;
}

export interface LedgerRow extends LedgerEvent {
  balanceCt: number;
}

export interface CreditSaleLike {
  created_at: string;
  ticket_number: string;
  total_ttc: number;
}

export interface SettlementLike {
  date: string;
  payment_method: string;
  receipt_number?: string | null;
  id: string;
  amount: number;
}

export function buildStatementRows(
  creditSales: CreditSaleLike[],
  settlements: SettlementLike[],
  labels: { credit: string; settlement: (method: string) => string },
): LedgerRow[] {
  const events: LedgerEvent[] = [
    ...creditSales.map(s => ({
      date: s.created_at,
      label: labels.credit,
      ref: s.ticket_number,
      debitCt: dzdToCentimes(s.total_ttc),
      creditCt: 0,
    })),
    ...settlements.map(st => ({
      date: st.date,
      label: labels.settlement(st.payment_method),
      ref: st.receipt_number ?? st.id.slice(0, 8),
      debitCt: 0,
      creditCt: dzdToCentimes(st.amount),
    })),
  ];
  events.sort((a, b) => a.date.localeCompare(b.date));
  let bal = 0;
  return events.map(e => {
    bal += e.debitCt - e.creditCt;
    return { ...e, balanceCt: bal };
  });
}
