import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Client, DebtSettlement, Sale } from '../../types';
import { formatDZD } from '../../core/display';
import { dzdToCentimes } from '../../core/money';
import { buildStatementRows, type LedgerRow } from '../../core/statement-ledger';
import { Printer, X, FileText } from 'lucide-react';

interface Props {
  client: Client;
  creditSales: Sale[];
  settlements: DebtSettlement[];
  onClose: () => void;
}

// Row: shared shape from the pure ledger builder (C2).
type Row = LedgerRow;

/**
 * Gate-03 TASK 2 — Relevé de Compte Client (statement of account).
 * Chronological running ledger: CREDIT purchases (+) vs quittance
 * settlements (−). Timbre is fiscal stamp collected ON TOP — it never
 * reduces the debt, so it is shown as memo, excluded from the balance.
 * Toggle 80mm (thermal) / A4 (audit) layouts, both printable.
 */
export const ClientAccountStatement: React.FC<Props> = ({ client, creditSales, settlements, onClose }) => {
  const { storeProfile, language } = useApp();
  const isAr = language === 'ar';
  const [format, setFormat] = useState<'80mm' | 'A4'>('80mm');

  // C2: chronological ledger via the guard-tested pure builder.
  const rows = useMemo<Row[]>(() => buildStatementRows(creditSales, settlements, {
    credit: isAr ? 'شراء بالكريدي' : 'Achat à crédit',
    settlement: (m: string) => isAr ? `تسديد ${m}` : `Versement ${m}`,
  }), [creditSales, settlements, isAr]);

  const totalDebitCt = rows.reduce((a, r) => a + r.debitCt, 0);
  const totalCreditCt = rows.reduce((a, r) => a + r.creditCt, 0);
  const netCt = totalDebitCt - totalCreditCt;
  const timbreMemoCt = settlements.reduce((a, s) => a + dzdToCentimes(s.timbre_fiscal ?? 0), 0);
  // D12-fix: the ledger is event-sourced, so seeded/historical debt is invisible
  // to it. Reconcile honestly: opening = current header balance − ledger net.
  const openingCt = Math.round(client.credit_balance * 100) - netCt;
  const now = new Date().toLocaleString('fr-FR');

  const ledger = (wide: boolean) => (
    <table className={`w-full ${wide ? 'text-xs' : 'text-[10px]'} font-mono`}>
      <thead>
        <tr className="border-b border-slate-700 text-slate-400">
          <th className="text-start py-1">{isAr ? 'التاريخ' : 'Date'}</th>
          <th className="text-start py-1">{isAr ? 'البيان' : 'Libellé'}</th>
          <th className="text-end py-1">{isAr ? 'دَين +' : 'Débit +'}</th>
          <th className="text-end py-1">{isAr ? 'تسديد −' : 'Crédit −'}</th>
          <th className="text-end py-1">{isAr ? 'الرصيد' : 'Solde'}</th>
        </tr>
      </thead>
      <tbody>
        <tr className="text-slate-500">
          <td className="py-1">—</td>
          <td>{isAr ? 'الرصيد الافتتاحي' : 'Solde initial'}</td>
          <td className="text-end">—</td><td className="text-end">—</td>
          <td className="text-end">{formatDZD(openingCt / 100, false)}</td>
        </tr>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-slate-800/60 text-slate-200">
            <td className="py-1">{new Date(r.date).toLocaleDateString('fr-FR')}</td>
            <td>{r.label} <span className="text-slate-500">· {r.ref}</span></td>
            <td className="text-end text-rose-400">{r.debitCt ? formatDZD(r.debitCt / 100, false) : '—'}</td>
            <td className="text-end text-emerald-400">{r.creditCt ? formatDZD(r.creditCt / 100, false) : '—'}</td>
            <td className="text-end font-bold">{formatDZD(r.balanceCt / 100, false)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <div className={`bg-[#0b0f17] border border-[#2b3a4f] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] ${format === 'A4' ? 'w-full max-w-3xl' : 'w-full max-w-sm'}`}>
        <div className="px-4 py-3 border-b border-[#1e293b] flex items-center gap-2 print:hidden">
          <FileText className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-bold text-white flex-1">{isAr ? 'كشف حساب العميل' : 'Relevé de Compte Client'}</span>
          <div className="flex rounded-lg overflow-hidden border border-[#2b3a4f] text-[11px]">
            {(['80mm', 'A4'] as const).map(f => (
              <button key={f} onClick={() => setFormat(f)} className={`px-2.5 py-1 cursor-pointer ${format === f ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>{f}</button>
            ))}
          </div>
          <button onClick={() => window.print()} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer">
            <Printer className="w-3.5 h-3.5" /> {isAr ? 'طباعة' : 'Imprimer'}
          </button>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-4 text-slate-200">
          <div className="text-center mb-3">
            <div className="text-sm font-black text-white">{isAr ? storeProfile.store_name : storeProfile.store_name}</div>
            <div className="text-[10px] text-slate-400">RC {storeProfile.rc_number} • NIF {storeProfile.nif_number} • {storeProfile.phone}</div>
            <div className="text-[11px] font-bold text-amber-300 mt-1">{isAr ? 'كشف حساب — RELEVÉ DE COMPTE' : 'RELEVÉ DE COMPTE — كشف حساب'}</div>
          </div>
          <div className="text-[11px] bg-[#162030] border border-[#233145] rounded-xl p-2.5 mb-3 flex justify-between">
            <span><span className="text-slate-400">{isAr ? 'العميل: ' : 'Client: '}</span><b className="text-white">{client.name}</b> <span className="text-slate-500">• {client.phone || '—'}</span></span>
            <span className="text-slate-400">{now}</span>
          </div>
          {ledger(format === 'A4')}
          <div className="mt-3 border-t-2 border-slate-600 pt-2 text-[11px] space-y-1 font-mono">
            <div className="flex justify-between"><span className="text-slate-400">{isAr ? 'مجموع الديون' : 'Total débits'}</span><b className="text-rose-400">{formatDZD(totalDebitCt / 100, false)}</b></div>
            <div className="flex justify-between"><span className="text-slate-400">{isAr ? 'مجموع التسديدات' : 'Total versements'}</span><b className="text-emerald-400">{formatDZD(totalCreditCt / 100, false)}</b></div>
            {timbreMemoCt > 0 && (
              <div className="flex justify-between text-slate-500"><span>{isAr ? 'طابع جبائي محصّل (مذكرة)' : 'Timbre perçu (mémo, hors solde)'}</span><span>{formatDZD(timbreMemoCt / 100, false)}</span></div>
            )}
            <div className="flex justify-between text-sm pt-1 border-t border-slate-700">
              <span className="font-bold text-white">{isAr ? 'الرصيد المدين الحالي' : 'SOLDE DÉBITEUR ACTUEL'}</span>
              <b className="text-amber-300">{formatDZD((openingCt + netCt) / 100, false)}</b>
            </div>
          </div>
          <div className={`grid grid-cols-2 gap-4 mt-6 text-[10px] text-slate-400 ${format === '80mm' ? 'pb-2' : 'pb-2'}`}>
            <div className="border-t border-slate-600 pt-1 text-center">{isAr ? 'توقيع العميل' : 'Signature client'}</div>
            <div className="border-t border-slate-600 pt-1 text-center">{isAr ? 'ختم المحل' : 'Cachet du magasin'}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
