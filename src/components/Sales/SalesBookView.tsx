/**
 * Baraka Market — Sales book (v1.6.0, master/detail).
 * The receipt-level bridge: one business day of FACTs, newest first —
 * search/jump by FACT, open a receipt for its lines + returned math,
 * print a governed DUPLICATA (audit row first, watermark on paper),
 * filter/export the day (P3) and read its health vs accounting (P4).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, CalendarDays, ChevronLeft, ChevronRight, Download,
  Search, SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatDZDFromCt } from '../../core/display';
import { fiscalDayISO } from '../../core/fiscal-day';
import {
  buildSalesBookCsv, computeSalesBookHealth, EMPTY_SALES_BOOK_FILTERS, fetchZDaySummary,
  filterSalesBookRows, getSalesBookDetail, listSalesDay, recordDuplicata, salesBookCashiers,
  type SalesBookDetail, type SalesBookFilters,
} from '../../core/sales-book-authority';
import { detailToSale } from '../../core/sales-book-detail';
import { useAsyncResource } from '../../core/use-async';
import { SalesHealthGrid } from './SalesHealthGrid';
import { PAY_LABEL, SalesListPanel } from './SalesListPanel';
import { SalesDetailDock } from './SalesDetailDock';
import { lookupReturnSale } from '../../core/returns-authority';
import { TicketThermal80mm } from '../Receipts/TicketThermal80mm';
import type { Sale } from '../../types';

export const SalesBookView: React.FC = () => {
  const { language, session } = useApp();
  const isAr = language === 'ar';
  const actor = session?.username ?? '';

  const [day, setDay] = useState(() => fiscalDayISO(new Date()));
  const [jump, setJump] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SalesBookDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [dupReason, setDupReason] = useState('');
  const [dupBusy, setDupBusy] = useState(false);
  const [dupSale, setDupSale] = useState<Sale | null>(null);
  const [filters, setFilters] = useState<SalesBookFilters>(EMPTY_SALES_BOOK_FILTERS);

  // MKT-007: the day ledger is a shared async resource — the desk keeps the
  // previous day visible while the new one loads (no skeleton flash).
  const snap = useAsyncResource(async () => {
    const [out, zsum] = await Promise.all([listSalesDay(day), fetchZDaySummary(day)]);
    if (!out) {
      const { lastSalesBookError } = await import('../../core/sales-book-authority');
      throw new Error(lastSalesBookError() ?? 'sales-book lane error');
    }
    return { rows: out, z: zsum };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);
  const rows = snap.data?.rows ?? null;
  const z = snap.data?.z ?? null;
  const err = snap.error ? String((snap.error as Error).message ?? snap.error) : null;
  const openedDay = useRef<string | null>(null);
  const firstDay = useRef(day);
  useEffect(() => {
    // Day switch: retire the old selection, reload the shared resource.
    // (Mount is covered by the resource itself — no double fetch.)
    if (firstDay.current === day) return;
    setSelectedId(null); setDetail(null); setDetailErr(null); setDupSale(null);
    openedDay.current = null;
    void snap.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailErr(null);
    setDetail(null);
    setDupSale(null);
    const d = await getSalesBookDetail(id);
    if (!d) { const { lastSalesBookError } = await import('../../core/sales-book-authority'); setDetailErr(lastSalesBookError()); return; }
    setDetail(d);
    // Keep the selection mapped: bring the active row into the list's own
    // view by scrolling the list container only — the page never moves.
    requestAnimationFrame(() => {
      const list = document.querySelector('[data-testid="sales-list"]');
      const sel = list?.querySelector('[aria-current="true"]');
      if (!list || !sel) return;
      const lr = list.getBoundingClientRect();
      const sr = (sel as HTMLElement).getBoundingClientRect();
      if (sr.bottom > lr.bottom) list.scrollTop += sr.bottom - lr.bottom;
      else if (sr.top < lr.top) list.scrollTop -= lr.top - sr.top;
    });
  }, []);

  // The desk opens on the newest receipt: once the day lands, the dock
  // auto-opens — but never re-opens after the cashier closes it by hand.
  useEffect(() => {
    const out = snap.data?.rows;
    if (out && out.length > 0 && openedDay.current !== day) {
      openedDay.current = day;
      void openDetail(out[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.data, day]);

  const shiftDay = (delta: number) => {
    const t = new Date(day + 'T12:00:00');
    t.setDate(t.getDate() + delta);
    setDay(fiscalDayISO(t));
  };

  const closeDetail = () => { setDetail(null); setDetailErr(null); setDupSale(null); setSelectedId(null); };

  const doJump = async () => {
    const k = jump.trim();
    if (!k) return;
    setDetailErr(null);
    const found = await lookupReturnSale(k);
    if (!found) { setDetailErr(isAr ? 'لا وصل بهذا الرقم.' : 'Aucun ticket pour ce code.'); return; }
    await openDetail(found.sale.id);
    setJump('');
  };

  const doDuplicata = async () => {
    if (!detail || dupBusy) return;
    setDupBusy(true);
    setDetailErr(null);
    const ok = await recordDuplicata(String(detail.head.id), actor, dupReason.trim() || undefined);
    setDupBusy(false);
    if (!ok) {
      const { lastSalesBookError } = await import('../../core/sales-book-authority');
      // P0: unified lane-error translator (Zero-Trust stays shut).
      const { friendlyLaneError } = await import('../../core/lane-error');
      setDetailErr(friendlyLaneError(lastSalesBookError(), isAr));
      return;
    }
    setDupSale(detailToSale(detail));
  };

  const health = useMemo(() => (rows ? computeSalesBookHealth(rows) : null), [rows]);
  const cashiers = useMemo(() => (rows ? salesBookCashiers(rows) : []), [rows]);
  const filtered = useMemo(() => (rows ? filterSalesBookRows(rows, filters) : null), [rows, filters]);
  const filtersActive = useMemo(() => JSON.stringify(filters) !== JSON.stringify(EMPTY_SALES_BOOK_FILTERS), [filters]);
  const zMatch = health !== null && z !== null
    && health.gross_ct === z.total_ttc_ct && health.count === z.sales_count;

  const doExportCsv = () => {
    if (!filtered || filtered.length === 0) return;
    const blob = new Blob([buildSalesBookCsv(filtered, day, isAr ? 'ar' : 'fr')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ventes-${day}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="space-y-4 text-slate-100">
      {/* Hero — the receipt-level bridge. */}
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute top-0 bottom-0 start-0 w-1 bg-emerald-500" />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">
              {isAr ? 'دفتر المبيعات — القائمة والتفاصيل جنبًا إلى جنب' : 'Registre des ventes — liste et détail côte à côte'}
            </h2>
            <p className="text-xs text-slate-400">
              {isAr ? 'اختر أي وصل من القائمة — سطوره وتدقيق Duplicata يظهران في اللوحة الجانبية بلا تمرير.' : 'Choisissez un ticket — ses lignes et le duplicata gouverné restent dans le panneau latéral, sans défiler.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {[
            { n: '01', t: isAr ? 'يوم + صحة' : 'Jour + santé' },
            { n: '02', t: isAr ? 'قائمة + تفاصيل' : 'Liste + détail' },
            { n: '03', t: isAr ? 'Duplicata محوكم' : 'Duplicata gouverné' },
            { n: '04', t: isAr ? 'فلاتر + تصدير' : 'Filtres + export' },
          ].map(s => (
            <span key={s.n} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#0b0f17] border border-[#2b3a4f] text-slate-300">
              <span className="font-mono text-emerald-400">{s.n}</span> {s.t}
            </span>
          ))}
        </div>
      </div>

      {/* 01 · Day + health + jump. */}
      <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">01</span>
          <CalendarDays className="w-4 h-4 text-emerald-400" />
          <button type="button" onClick={() => shiftDay(-1)} className="p-2 rounded-lg border border-[#2b3a4f] text-slate-300 hover:text-white" title={isAr ? 'اليوم السابق' : 'Jour précédent'}>
            <ChevronRight className="w-4 h-4 rtl:rotate-0" />
          </button>
          <input type="date" value={day} max={fiscalDayISO(new Date())} onChange={e => { if (e.target.value) setDay(e.target.value); }}
            className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg px-2.5 py-2 text-sm text-slate-200 font-mono" dir="ltr" />
          <button type="button" onClick={() => shiftDay(1)} disabled={day >= fiscalDayISO(new Date())} className="p-2 rounded-lg border border-[#2b3a4f] text-slate-300 hover:text-white disabled:opacity-30" title={isAr ? 'اليوم التالي' : 'Jour suivant'}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setDay(fiscalDayISO(new Date()))} className="px-3 py-2 rounded-lg border border-[#2b3a4f] text-xs font-bold text-slate-300 hover:text-white">
            {isAr ? 'اليوم' : "Aujourd'hui"}
          </button>
          {health && (
            <span className="ms-auto text-[11px] font-bold text-slate-400" dir="ltr">
              {health.count} · {formatDZDFromCt(health.net_ct)}{health.cancelled > 0 ? ` (${health.cancelled} ✕)` : ''}
            </span>
          )}
          {z && health && (
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${zMatch ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900 text-amber-200'}`}
              title={isAr ? 'مقارنة مع المحاسبة (Z)' : 'Comparaison comptable (Z)'}>
              {zMatch ? (isAr ? '✓ يطابق المحاسبة' : '✓ Conforme compta') : (isAr ? '! يختلف عن المحاسبة' : '! Écart compta')}
            </span>
          )}
        </div>
        {health && <SalesHealthGrid health={health} isAr={isAr} />}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative ms-auto min-w-52 flex-1 sm:flex-none">
            <Search className="w-4 h-4 absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input value={jump} onChange={e => setJump(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void doJump(); }}
              placeholder={isAr ? 'اقفز لـ FACT… (رقم/قصير/لاحقة)' : 'Aller au FACT…'}
              className="w-full sm:w-64 bg-[#0b0f17] border border-[#2b3a4f] rounded-lg ps-8 pe-2 py-2 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-emerald-500 font-mono" dir="ltr" />
          </div>
        </div>
        {err && <p className="text-xs text-red-300 font-bold">{err}</p>}
        {/* P3 · Filters + CSV export. */}
        {rows && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2">
            <SlidersHorizontal className="w-4 h-4 text-slate-500" />
            <input value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })}
              placeholder={isAr ? 'بحث FACT… (42)' : 'Filtrer FACT…'}
              className="w-36 bg-[#162030] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-emerald-500 font-mono" dir="ltr" />
            <select value={filters.cashier} onChange={e => setFilters({ ...filters, cashier: e.target.value })}
              className="bg-[#162030] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none">
              <option value="">{isAr ? 'كل الكاشير' : 'Tous caissiers'}</option>
              {cashiers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filters.pay} onChange={e => setFilters({ ...filters, pay: e.target.value as SalesBookFilters['pay'] })}
              className="bg-[#162030] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none">
              <option value="">{isAr ? 'كل الدفع' : 'Tout paiement'}</option>
              {(['ESPECES', 'CIB', 'DAHABIYA', 'CREDIT'] as const).map(p => (
                <option key={p} value={p}>{PAY_LABEL[p]?.[isAr ? 'ar' : 'fr'] ?? p}</option>
              ))}
            </select>
            {[
              { v: '' as const, t: isAr ? 'الكل' : 'Tous' },
              { v: 'avoir' as const, t: 'AVOIR' },
              { v: 'cancelled' as const, t: isAr ? 'ملغاة' : 'Annulées' },
            ].map(o => (
              <button key={o.v || 'all'} type="button" onClick={() => setFilters({ ...filters, flag: o.v })}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${filters.flag === o.v ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300' : 'border-[#2b3a4f] text-slate-400 hover:text-white'}`}>
                {o.t}
              </button>
            ))}
            {[
              { v: '' as const, t: isAr ? 'زبون: الكل' : 'Client: tous' },
              { v: 'named' as const, t: isAr ? 'مسجل' : 'Nommé' },
              { v: 'walkin' as const, t: isAr ? 'عابر' : 'Passage' },
            ].map(o => (
              <button key={o.v || 'allc'} type="button" onClick={() => setFilters({ ...filters, client: o.v })}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${filters.client === o.v ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300' : 'border-[#2b3a4f] text-slate-400 hover:text-white'}`}>
                {o.t}
              </button>
            ))}
            {filtersActive && (
              <button type="button" onClick={() => setFilters(EMPTY_SALES_BOOK_FILTERS)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-white underline">
                {isAr ? 'مسح' : 'Effacer'}
              </button>
            )}
            <button type="button" onClick={doExportCsv} disabled={!filtered || filtered.length === 0}
              className="ms-auto px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-40 text-xs font-black flex items-center gap-1.5 cursor-pointer">
              <Download className="w-3.5 h-3.5" />
              CSV · {filtered?.length ?? 0}
            </button>
          </div>
        )}
      </section>

      {/* MKT-007: master/detail grid — list scrolls in its dock, receipt pinned. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
      <SalesListPanel
        filtered={filtered} rows={rows} err={err} selectedId={selectedId}
        isAr={isAr} onOpen={id => void openDetail(id)}
        onClearFilters={() => setFilters(EMPTY_SALES_BOOK_FILTERS)}
      />
        <SalesDetailDock
          detail={detail} detailErr={detailErr}
          dupReason={dupReason} onDupReason={setDupReason} dupBusy={dupBusy}
          actor={actor} isAr={isAr} onClose={closeDetail}
          onDuplicata={() => void doDuplicata()}
        />
      </div>

      {/* Governed reprint preview. */}
      {dupSale && (
        <TicketThermal80mm sale={dupSale} duplicata onClose={() => setDupSale(null)} />
      )}
    </div>
  );
};
