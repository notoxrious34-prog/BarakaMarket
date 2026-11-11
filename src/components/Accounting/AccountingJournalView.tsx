import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ExpensesWorkersView } from './ExpensesWorkersView';
import { formatDZD } from '../../core/display';
import {
  buildJournalEntries,
  filterJournalByPeriod,
  journalToCsv,
  type JournalPeriod,
  type SaleReturn,
  type StockLoss,
} from '../../core/compta-kernel';
import { listReturns } from '../../core/returns-authority';
import { listLossesNative } from '../../core/fiscal-authority';
import { calculateAccountingSummary } from '../../utils/accounting';
import {
  PieChart,
  TrendingUp,
  DollarSign,
  PackageCheck,
  CreditCard,
  Building,
  Printer,
  FileSpreadsheet,
  Layers,
} from 'lucide-react';

/**
 * Compta (v1.4.5 rebuild, C-lane institutional audit).
 * Thin renderer over two tested kernels:
 * - compta-kernel: SCF journal (voids excluded, 530/512 split, timbre memo),
 *   live period filter, accountant CSV handoff.
 * - utils/accounting: margins/PMP/treasury (expenses deducted, cost-at-sale).
 * Period cards show the selected window; snapshot cards (stock, balances,
 * treasury) are cumulative by nature and labelled as such.
 */
export const AccountingJournalView: React.FC = () => {
  const { accountingSummary, sales, purchases, products, clients, suppliers, settlements, supplierPayments, expenses, language } = useApp();
  const isAr = language === 'ar';

  // C4-fix: the period filter is now wired to the journal AND the flow KPIs.
  const [filterPeriod, setFilterPeriod] = useState<JournalPeriod>('all');

  // Phase C (supermarket): reversal legs come from the fiscal lanes, not
  // localStorage — approved returns (AVOIR) + DESTROY waste (PERTE). A
  // failed fetch surfaces as an empty leg with a banner, never a fake zero.
  const [retLeg, setRetLeg] = useState<SaleReturn[]>([]);
  const [lossLeg, setLossLeg] = useState<StockLoss[]>([]);
  const [legsFailed, setLegsFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [rets, losses] = await Promise.all([
          listReturns('APPROVED'),
          listLossesNative(500),
        ]);
        if (!alive) return;
        if (rets === null) { setLegsFailed(true); return; }
        setRetLeg(rets.map(r => ({
          id: r.id, date: r.posting_day ?? r.created_at, ref: r.return_number ?? r.id,
          invoice_number: r.invoice_number, payment_method: r.payment_method as SaleReturn['payment_method'],
          refund_ct: r.refund_ct, status: r.status,
        })));
        setLossLeg(losses.map(l => ({
          id: l.id as number | string, date: String(l.created_at ?? ''),
          product_name: String(l.product_name ?? '—'),
          total_loss_ct: Number(l.total_loss_ct ?? 0),
        })));
      } catch {
        if (alive) setLegsFailed(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const handlePrint = () => {
    window.print();
  };

  // SCF journal from the tested kernel (C3/C6/C7/C9 fixed at the source).
  // Phase C: approved returns + DESTROY waste ride as AVOIR/PERTE legs.
  const journalEntries = useMemo(
    () => buildJournalEntries({ sales, purchases, settlements, supplierPayments, expenses, returns: retLeg, losses: lossLeg }),
    [sales, purchases, settlements, supplierPayments, expenses, retLeg, lossLeg]
  );
  const visibleJournal = useMemo(
    () => filterJournalByPeriod(journalEntries, filterPeriod),
    [journalEntries, filterPeriod]
  );

  const handleCsv = () => {
    const blob = new Blob([journalToCsv(visibleJournal)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal-scf-${filterPeriod}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Period-scoped flows for the margin/CA cards (snapshots stay global).
  const inPeriod = (dateStr: string) => {
    if (filterPeriod === 'all') return true;
    const now = new Date();
    if (filterPeriod === 'today') return dateStr.slice(0, 10) === now.toISOString().slice(0, 10);
    return dateStr.slice(0, 7) === now.toISOString().slice(0, 7);
  };
  const periodSummary = useMemo(
    () =>
      calculateAccountingSummary(
        sales.filter(s => inPeriod(s.created_at)),
        purchases.filter(p => inPeriod(p.date)),
        products,
        clients,
        suppliers,
        settlements.filter(s => inPeriod(s.date)),
        supplierPayments.filter(s => inPeriod(s.date)),
        expenses.filter(e => inPeriod(e.date))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, purchases, products, clients, suppliers, settlements, supplierPayments, expenses, filterPeriod]
  );

  const periodLabel = filterPeriod === 'all'
    ? (isAr ? 'كل الفترات' : 'Toutes périodes')
    : filterPeriod === 'today'
      ? (isAr ? 'اليوم' : "Aujourd'hui")
      : (isAr ? 'هذا الشهر' : 'Ce mois');

  // Latent stock margin (Valeur Retail - Valeur PMP)
  const potentialStockMargin = Math.max(
    0,
    accountingSummary.total_stock_value_retail - accountingSummary.total_stock_value_pmp
  );

  const netDebt = accountingSummary.total_client_receivables - accountingSummary.total_supplier_payables;

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
          {/* MKT-008: Desk steps — 01 نظرة / 02 اليومية / 03 المصاريف. */}
          <div className="flex flex-wrap gap-2 mt-3">
            {[
              { n: '01', t: isAr ? 'نظرة مالية' : 'Vue financière' },
              { n: '02', t: isAr ? 'اليومية العامة' : 'Journal général' },
              { n: '03', t: isAr ? 'المصاريف والعمال' : 'Dépenses & employés' },
            ].map(s => (
              <span key={s.n} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#111722] border border-[#2b3a4f] text-slate-300">
                <span className="font-mono text-emerald-400">{s.n}</span> {s.t}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* C4: period selector — اليوم / الشهر / الكل */}
          <div className="flex rounded-xl overflow-hidden border border-[#2b3a4f] text-xs font-bold" role="group" aria-label={isAr ? 'الفترة' : 'Période'}>
            {(['today', 'month', 'all'] as const).map(p => (
              <button
                key={p}
                onClick={() => setFilterPeriod(p)}
                className={`px-3 py-2 cursor-pointer ${filterPeriod === p ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {p === 'today' ? (isAr ? 'اليوم' : 'Jour') : p === 'month' ? (isAr ? 'الشهر' : 'Mois') : (isAr ? 'الكل' : 'Tout')}
              </button>
            ))}
          </div>
          <button
            onClick={handleCsv}
            className="px-4 py-2 bg-[#162030] hover:bg-[#233145] border border-[#2b3a4f] text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>CSV</span>
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{isAr ? 'طباعة التقرير المحاسبي' : 'Imprimer Synthèse'}</span>
          </button>
        </div>
      </div>

      {/* Printable SCF synthesis (C10-fix: window.print() now has a target). */}
      <div id="printable-compta">
      {/* Phase C: legs-failure banner — reversals missing is stated, never silent. */}
      {legsFailed && (
        <div className="mb-4 px-4 py-2 rounded-xl border border-amber-700 bg-amber-950/40 text-amber-300 text-xs font-bold">
          {isAr
            ? 'تعذر تحميل المرتجعات المعتمدة / الهالك — الدفتر يعرض بدون ساقي AVOIR وPERTE'
            : 'Retours/casse non chargés — journal sans jambes AVOIR/PERTE'}
        </div>
      )}
      {/* 01 · Primary Financial KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gross Margin */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              <span>{isAr ? 'الهامش التجاري الإجمالي:' : 'Marge Commerciale Brute:'}</span>
            </span>
            <span className="font-mono bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-800">
              {periodSummary.gross_margin_percent}%
            </span>
          </div>
          <div className="text-2xl font-black font-mono text-emerald-400 mt-2" dir="ltr">
            {formatDZD(periodSummary.gross_margin_dzd, false)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            CAMV: <strong dir="ltr">{formatDZD(periodSummary.total_cost_of_goods_sold, false)}</strong>
            {' '}• {periodLabel}
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
              {formatDZD(periodSummary.total_sales_ttc, false)}
            </div>
            <p className="text-[10px] text-slate-400">
              HT: <strong dir="ltr">{formatDZD(periodSummary.total_sales_ht, false)}</strong> • {periodLabel}
            </p>
          </div>
        </div>
      </div>

      {/* General Accounting Ledger (Journal Général des Écritures) */}
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 border-b border-[#1e293b] pb-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">02</span>
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>{isAr ? 'دفتر اليومية العامة للعمليات المحاسبية (Journal Général SCF)' : 'Journal Général des Écritures Comptables'}</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              {isAr ? 'تتبع زمني دقيق لكل حركة بيع، شراء، دفع أو تسديد وفق مدونة الحسابات' : 'Enregistrement chronologique débit / crédit conforme au SCF'}
              {' '}• {periodLabel}
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {visibleJournal.length} {isAr ? 'قيد محاسبي' : 'écritures'}
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
              {visibleJournal.map(entry => (
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
                    <div className="font-semibold text-white">
                      {entry.label}
                      {entry.provisional && (
                        <span className="ms-2 text-[10px] font-mono text-amber-300 border border-amber-700 rounded px-1">
                          {isAr ? 'مؤقت' : 'PROV'}
                        </span>
                      )}
                    </div>
                    {entry.timbreDzd > 0 && (
                      <div className="text-[10px] text-slate-500 font-mono" dir="ltr">
                        + timbre {formatDZD(entry.timbreDzd, false)}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-sky-400">
                    {entry.debitAccount}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-purple-400">
                    {entry.creditAccount}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono font-bold text-emerald-400" dir="ltr">
                    {formatDZD(entry.amountDzd, false)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleJournal.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500">
              {isAr ? 'لا قيود في هذه الفترة' : 'Aucune écriture sur cette période'}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* P2 (v1.4.4): shop expenses + worker accounts */}
      <ExpensesWorkersView />
    </div>
  );
};
