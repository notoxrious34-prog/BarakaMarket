import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatDZD } from '../../core/display';
import {
  PieChart,
  TrendingUp,
  DollarSign,
  PackageCheck,
  CreditCard,
  Building,
  Printer,
  FileSpreadsheet,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Layers,
  CheckCircle2,
} from 'lucide-react';

export const AccountingJournalView: React.FC = () => {
  const { accountingSummary, sales, purchases, settlements, supplierPayments, language } = useApp();
  const isAr = language === 'ar';

  const [filterPeriod, setFilterPeriod] = useState<'all' | 'today' | 'month'>('all');

  const handlePrint = () => {
    window.print();
  };

  // Compile general journal entries chronologically
  const journalEntries: {
    id: string;
    date: string;
    type: 'VENTE' | 'ACHAT' | 'ENCAISSEMENT' | 'DECAISSEMENT';
    ref: string;
    label: string;
    debitAccount: string;
    creditAccount: string;
    amount: number;
  }[] = [];

  // 1. Sales
  for (const s of sales) {
    journalEntries.push({
      id: s.id,
      date: s.created_at,
      type: 'VENTE',
      ref: s.ticket_number,
      label: `Vente au comptoir (${s.items.length} articles) - ${s.payment_method}`,
      debitAccount: s.payment_method === 'CREDIT' ? '411000 Clients (Crédit)' : '530000 Caisse Espèces',
      creditAccount: '700000 Ventes Marchandises + 4457 TVA',
      amount: s.total_ttc,
    });
  }

  // 2. Inbound Purchases from Suppliers
  for (const p of purchases) {
    journalEntries.push({
      id: p.id,
      date: p.date,
      type: 'ACHAT',
      ref: p.invoice_number,
      label: `Approvisionnement stock - ${p.supplier_name}`,
      debitAccount: '300000 Stock Marchandises (au PMP)',
      creditAccount: p.payment_method === 'CREDIT' ? '401000 Fournisseurs' : '530000 Caisse / 512 Banque',
      amount: p.total_ttc,
    });
  }

  // 3. Client Debt Settlements
  for (const cs of settlements) {
    journalEntries.push({
      id: cs.id,
      date: cs.date,
      type: 'ENCAISSEMENT',
      ref: cs.id,
      label: `Règlement créance client - ${cs.client_name}`,
      debitAccount: cs.payment_method === 'ESPECES' ? '530000 Caisse Espèces' : '512000 Banque CIB',
      creditAccount: '411000 Clients (Carnet de Dette)',
      amount: cs.amount,
    });
  }

  // 4. Supplier Payments
  for (const sp of supplierPayments) {
    journalEntries.push({
      id: sp.id,
      date: sp.date,
      type: 'DECAISSEMENT',
      ref: sp.reference || sp.id,
      label: `Paiement dette fournisseur - ${sp.supplier_name}`,
      debitAccount: '401000 Fournisseurs',
      creditAccount: sp.payment_method === 'ESPECES' ? '530000 Caisse' : '512000 Banque Chèque',
      amount: sp.amount,
    });
  }

  // Sort descending by date
  journalEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Latent stock margin (Valeur Retail - Valeur PMP)
  const potentialStockMargin = Math.max(
    0,
    accountingSummary.total_stock_value_retail - accountingSummary.total_stock_value_pmp
  );

  return (
    <div className="flex-1 bg-[#0b0f17] p-5 overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-[#1e293b] pb-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <PieChart className="w-5 h-5 text-emerald-400" />
            <span>{isAr ? 'التقرير والربط المحاسبي الدقيق (Bilan & SCF Algérien)' : 'Bilan Comptable & Marges Commerciales SCF'}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isAr
              ? 'متابعة هوامش الربح، تقييم المخزون بـ PMP، الديون، الخزينة، ودفتر اليومية العامة'
              : 'Système Comptable Financier: Marges brutes, valorisation stock au PMP, créances et journal général'}
          </p>
        </div>

        <button
          onClick={handlePrint}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          <span>{isAr ? 'طباعة التقرير المحاسبي' : 'Imprimer Synthèse'}</span>
        </button>
      </div>

      {/* Primary Financial KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gross Margin */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              <span>{isAr ? 'الهامش التجاري الإجمالي:' : 'Marge Commerciale Brute:'}</span>
            </span>
            <span className="font-mono bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-800">
              {accountingSummary.gross_margin_percent}%
            </span>
          </div>
          <div className="text-2xl font-black font-mono text-emerald-400 mt-2" dir="ltr">
            {formatDZD(accountingSummary.gross_margin_dzd, false)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            CAMV: <strong dir="ltr">{formatDZD(accountingSummary.total_cost_of_goods_sold, false)}</strong>
          </div>
        </div>

        {/* Stock Valuation at PMP */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between text-xs text-amber-400 font-semibold">
            <span className="flex items-center gap-1.5">
              <PackageCheck className="w-4 h-4" />
              <span>{isAr ? 'قيمة المخزون بسعر الشراء (PMP):' : 'Valeur Stock au PMP:'}</span>
            </span>
          </div>
          <div className="text-2xl font-black font-mono text-white mt-2" dir="ltr">
            <span dir="ltr">{formatDZD(accountingSummary.total_stock_value_pmp, false)}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {isAr ? 'بسعر البيع:' : 'Valeur Vente:'}{' '}
            <strong className="text-amber-300" dir="ltr">{formatDZD(accountingSummary.total_stock_value_retail, false)}</strong>
          </div>
        </div>

        {/* Client Receivables vs Supplier Payables */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between text-xs text-sky-400 font-semibold">
            <span className="flex items-center gap-1.5">
              <CreditCard className="w-4 h-4" />
              <span>{isAr ? 'ديون الزبائن / ديون الموردين:' : 'Créances / Dettes:'}</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div>
              <span className="text-[10px] text-rose-400 block">{isAr ? 'لنا عند الزبائن:' : 'Créances Clients:'}</span>
              <span className="text-lg font-bold font-mono text-rose-300" dir="ltr">
                {formatDZD(accountingSummary.total_client_receivables, false)}
              </span>
            </div>
            <div className="text-end">
              <span className="text-[10px] text-amber-400 block">{isAr ? 'علينا للموردين:' : 'Dettes Fournisseurs:'}</span>
              <span className="text-lg font-bold font-mono text-amber-300" dir="ltr">
                {formatDZD(accountingSummary.total_supplier_payables, false)}
              </span>
            </div>
          </div>
        </div>

        {/* Real-time Treasury */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold">
            <span className="flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" />
              <span>{isAr ? 'الخزينة المتاحة (Trésorerie):' : 'Trésorerie Disponible:'}</span>
            </span>
          </div>
          <div className="text-2xl font-black font-mono text-emerald-300 mt-2" dir="ltr">
            {formatDZD(accountingSummary.cash_treasury + accountingSummary.bank_treasury, false)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex justify-between">
            <span>Caisse: <strong className="text-slate-200" dir="ltr">{formatDZD(accountingSummary.cash_treasury, false)}</strong></span>
            <span>CIB: <strong className="text-slate-200" dir="ltr">{formatDZD(accountingSummary.bank_treasury, false)}</strong></span>
          </div>
        </div>
      </div>

      {/* Accounting Balance Comparison: Stock Potential Margin */}
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-400" />
          <span>{isAr ? 'التحليل المحاسبي للأصول والربحية المتوقعة' : 'Bilan Synthétique & Plus-Value Potentielle'}</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-[#162030] p-3.5 rounded-xl border border-[#233145] space-y-1">
            <span className="text-slate-400 font-medium">
              {isAr ? 'الهامش الكامن في مخزون المحل:' : 'Marge Latente sur Stock Magasin:'}
            </span>
            <div className="text-xl font-bold font-mono text-emerald-400" dir="ltr">
              +{formatDZD(potentialStockMargin, false)}
            </div>
            <p className="text-[10px] text-slate-400">
              {isAr ? 'الربح المتوقع تحقيقه عند بيع كامل السلع المخزنة بالأسعار المحددة' : 'Différence entre le prix de vente fixé et le coût moyen pondéré (PMP)'}
            </p>
          </div>

          <div className="bg-[#162030] p-3.5 rounded-xl border border-[#233145] space-y-1">
            <span className="text-slate-400 font-medium">
              {isAr ? 'صافي الموقف المالي للديون:' : 'Solde Net Créances / Dettes:'}
            </span>
            {(() => {
              const netDebt = accountingSummary.total_client_receivables - accountingSummary.total_supplier_payables;
              return (
                <div
                  className={`text-xl font-bold font-mono ${netDebt >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}
                  dir="ltr"
                >
                  {formatDZD(netDebt, false)}
                </div>
              );
            })()}
            <p className="text-[10px] text-slate-400">
              {isAr ? 'الفرق بين ما يملكه المحل عند الزبائن وما يدين به للموردين' : 'Position de trésorerie nette entre clients et fournisseurs'}
            </p>
          </div>

          <div className="bg-[#162030] p-3.5 rounded-xl border border-[#233145] space-y-1">
            <span className="text-slate-400 font-medium">
              {isAr ? 'التدفق المالي للمبيعات (Chiffre d\'Affaires):' : 'Chiffre d\'Affaires Global:'}
            </span>
            <div className="text-xl font-bold font-mono text-white" dir="ltr">
              {formatDZD(accountingSummary.total_sales_ttc, false)}
            </div>
            <p className="text-[10px] text-slate-400">
              HT: <strong dir="ltr">{formatDZD(accountingSummary.total_sales_ht, false)}</strong> • {sales.length} transactions
            </p>
          </div>
        </div>
      </div>

      {/* General Accounting Ledger (Journal Général des Écritures) */}
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 border-b border-[#1e293b] pb-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>{isAr ? 'دفتر اليومية العامة للعمليات المحاسبية (Journal Général SCF)' : 'Journal Général des Écritures Comptables'}</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              {isAr ? 'تتبع زمني دقيق لكل حركة بيع، شراء، دفع أو تسديد وفق مدونة الحسابات' : 'Enregistrement chronologique débit / crédit conforme au SCF'}
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {journalEntries.length} {isAr ? 'قيد محاسبي' : 'écritures'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs border-collapse">
            <thead className="bg-[#0b0f17] text-slate-400 uppercase text-[10px] font-semibold border-b border-[#1e293b]">
              <tr>
                <th className="py-2.5 px-3 text-start">{isAr ? 'التاريخ والساعة' : 'Date'}</th>
                <th className="py-2.5 px-3 text-start">{isAr ? 'المرجع' : 'Réf'}</th>
                <th className="py-2.5 px-3 text-start">{isAr ? 'البيان (Libellé)' : 'Libellé de l\'Opération'}</th>
                <th className="py-2.5 px-3 text-start">{isAr ? 'الحساب المدين (Débit)' : 'Compte Débit'}</th>
                <th className="py-2.5 px-3 text-start">{isAr ? 'الحساب الدائن (Crédit)' : 'Compte Crédit'}</th>
                <th className="py-2.5 px-3 text-end">{isAr ? 'المبلغ (TTC)' : 'Montant TTC'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#162030] text-slate-300">
              {journalEntries.map(entry => (
                <tr key={entry.id} className="hover:bg-[#162030]/60 transition-colors">
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                    {new Date(entry.date).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-bold text-amber-300 text-[11px]">
                    {entry.ref}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-white">{entry.label}</div>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-sky-400">
                    {entry.debitAccount}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-purple-400">
                    {entry.creditAccount}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono font-bold text-emerald-400" dir="ltr">
                    {formatDZD(entry.amount, false)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
