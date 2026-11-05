/**
 * compta-kernel.ts — pure SCF journal engine (C-lane, institutional audit).
 *
 * The Compta page used to hand-roll its journal inline with three fiscal
 * defects: voided sales journaled as VENTE, card sales debited to the cash
 * account, and a dead period filter. Every rule lives here, unit-tested,
 * so the view is a thin renderer.
 */
import type {
  DebtSettlement,
  Expense,
  ExpenseCategory,
  PurchaseInvoice,
  Sale,
  SupplierPayment,
} from '../types';
import { fiscalDayISO } from './fiscal-day';

export type JournalType = 'VENTE' | 'ACHAT' | 'ENCAISSEMENT' | 'DECAISSEMENT';

export interface JournalEntry {
  id: string;
  date: string;
  type: JournalType;
  ref: string;
  label: string;
  debitAccount: string;
  creditAccount: string;
  /** Display amount in DZD (2 decimals). */
  amountDzd: number;
  /** Art.136 timbre collected on top (ESPECES settlements) — memo, not debited. */
  timbreDzd: number;
  /** Provisional (DRAFT) rows: real economic events, not yet fiscal. */
  provisional: boolean;
}

export type JournalPeriod = 'all' | 'today' | 'month';

const ACC = {
  cash: '530000 Caisse Espèces',
  bank: '512000 Banque',
  bankCard: '512000 Banque CIB',
  bankCheque: '512000 Banque Chèque',
  clients: '411000 Clients (Crédit)',
  carnet: '411000 Clients (Carnet de Dette)',
  suppliers: '401000 Fournisseurs',
  stock: '300000 Stock Marchandises (au PMP)',
  sales: '700000 Ventes Marchandises + 4457 TVA',
} as const;

export const EXPENSE_DEBIT: Record<ExpenseCategory, string> = {
  LOYER: '613000 Locations',
  ELEC_EAU: '607000 Énergie / Eau',
  TRANSPORT: '625000 Transports',
  MAINTENANCE: '615000 Entretien',
  TELECOM: '626000 Télécom',
  SALAIRES: '631000 Salaires',
  AVANCES: '425000 Avances employés',
  AUTRE: '658000 Charges diverses',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface JournalInput {
  sales: Sale[];
  purchases: PurchaseInvoice[];
  settlements: DebtSettlement[];
  supplierPayments: SupplierPayment[];
  expenses: Expense[];
}

/**
 * C3/C6/C7/C9-fix: one tested builder for the whole journal.
 * - CANCELLED sales are legally dead: excluded (they live in the void journal).
 * - X1 (cross-audit): DRAFT/provisional rows are not fiscal yet — the Z lane,
 *   the server aggregates and the close payload all exclude them, so the
 *   journal does too (one rule, every book).
 * - Non-COMPLETED rows that survive (legacy) ride flagged PROV, never silent.
 * - Card/bank flows hit 512xxx, never the cash account.
 * - Settlement timbre rides along as an explicit memo amount.
 */
export function buildJournalEntries(input: JournalInput): JournalEntry[] {
  const out: JournalEntry[] = [];

  for (const s of input.sales) {
    if (s.status === 'CANCELLED') continue;
    if ((s as { is_provisional?: boolean }).is_provisional) continue; // X1: DRAFT is not fiscal yet
    const provisional = s.status !== 'COMPLETED';
    out.push({
      id: s.id,
      date: s.created_at,
      type: 'VENTE',
      ref: s.ticket_number,
      label: `Vente au comptoir (${s.items.length} articles) - ${s.payment_method}`,
      debitAccount:
        s.payment_method === 'CREDIT'
          ? ACC.clients
          : s.payment_method === 'ESPECES'
            ? ACC.cash
            : ACC.bankCard,
      creditAccount: ACC.sales,
      amountDzd: round2(s.total_ttc),
      timbreDzd: 0,
      provisional,
    });
  }

  for (const p of input.purchases) {
    out.push({
      id: p.id,
      date: p.date,
      type: 'ACHAT',
      ref: p.invoice_number,
      label: `Approvisionnement stock - ${p.supplier_name}`,
      debitAccount: ACC.stock,
      creditAccount:
        p.payment_method === 'CREDIT'
          ? ACC.suppliers
          : p.payment_method === 'ESPECES'
            ? ACC.cash
            : ACC.bank,
      amountDzd: round2(p.total_ttc),
      timbreDzd: 0,
      provisional: false,
    });
  }

  for (const cs of input.settlements) {
    const timbre = round2(cs.timbre_fiscal ?? 0);
    out.push({
      id: cs.id,
      date: cs.date,
      type: 'ENCAISSEMENT',
      ref: cs.receipt_number ?? cs.id,
      label:
        `Règlement créance client - ${cs.client_name}` +
        (timbre > 0 ? ` (timbre ${timbre} DZD)` : ''),
      debitAccount: cs.payment_method === 'ESPECES' ? ACC.cash : ACC.bankCard,
      creditAccount: ACC.carnet,
      amountDzd: round2(cs.amount),
      timbreDzd: timbre,
      provisional: false,
    });
  }

  for (const sp of input.supplierPayments) {
    out.push({
      id: sp.id,
      date: sp.date,
      type: 'DECAISSEMENT',
      ref: sp.reference || sp.id,
      label: `Paiement dette fournisseur - ${sp.supplier_name}`,
      debitAccount: ACC.suppliers,
      creditAccount: sp.payment_method === 'ESPECES' ? ACC.cash : ACC.bankCheque,
      amountDzd: round2(sp.amount),
      timbreDzd: 0,
      provisional: false,
    });
  }

  for (const ex of input.expenses) {
    out.push({
      id: ex.id,
      date: ex.date,
      type: 'DECAISSEMENT',
      ref: ex.id,
      label: `Dépense boutique - ${ex.note ?? ex.category}`,
      debitAccount: EXPENSE_DEBIT[ex.category] ?? EXPENSE_DEBIT.AUTRE,
      creditAccount: ex.method === 'ESPECES' ? ACC.cash : ACC.bank,
      amountDzd: round2(ex.amountCt / 100),
      timbreDzd: 0,
      provisional: false,
    });
  }

  out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return out;
}

/** C4-fix: the period filter the old page declared but never wired. */
export function filterJournalByPeriod(
  entries: JournalEntry[],
  period: JournalPeriod,
  now: Date = new Date(),
): JournalEntry[] {
  if (period === 'all') return entries;
  // F2 (v1.4.5): 'today' is the Africa/Algiers fiscal day, entry dates compare
  // through the same local-day lens (UTC edge-hours land in the local day).
  const today = fiscalDayISO(now);
  if (period === 'today') return entries.filter(e => fiscalDayISO(new Date(e.date)) === today);
  const month = fiscalDayISO(now).slice(0, 7);
  return entries.filter(e => e.date.slice(0, 7) === month);
}

/** Accountant handoff: semicolon CSV with BOM (Excel-FR friendly). */
export function journalToCsv(entries: JournalEntry[]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    'Date;Type;Réf;Libellé;Compte Débit;Compte Crédit;Montant DZD;Timbre DZD;Provisoire',
    ...entries.map(e =>
      [e.date, e.type, e.ref, e.label, e.debitAccount, e.creditAccount,
        e.amountDzd.toFixed(2), e.timbreDzd.toFixed(2), e.provisional ? 'OUI' : 'NON'
      ].map(esc).join(';'),
    ),
  ];
  return '﻿' + lines.join('\n');
}
