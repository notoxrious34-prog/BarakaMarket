/**
 * Baraka Market — Sales book (v1.6.0, master/detail).
 * The receipt-level bridge: one business day of FACTs, newest first —
 * search/jump by FACT, open a receipt for its lines + returned math,
 * print a governed DUPLICATA (audit row first, watermark on paper),
 * filter/export the day (P3) and read its health vs accounting (P4).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, CalendarDays, ChevronLeft, ChevronRight, Copy, Download, Printer,
  Receipt, Search, SlidersHorizontal, Undo2, X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatDZD, formatDZDFromCt } from '../../core/display';
import { fiscalDayISO } from '../../core/fiscal-day';
import {
  buildSalesBookCsv, computeSalesBookHealth, EMPTY_SALES_BOOK_FILTERS, fetchZDaySummary,
  filterSalesBookRows, getSalesBookDetail, listSalesDay, recordDuplicata, salesBookCashiers,
  type SalesBookDetail, type SalesBookFilters, type SalesBookRow, type ZDaySummary,
} from '../../core/sales-book-authority';
import { lookupReturnSale } from '../../core/returns-authority';
import { TicketThermal80mm } from '../Receipts/TicketThermal80mm';
import type { Sale } from '../../types';

const PAY_LABEL: Record<string, { ar: string; fr: string }> = {
  ESPECES: { ar: 'نقدًا', fr: 'Espèces' },
  CIB: { ar: 'CIB', fr: 'CIB' },
  DAHABIYA: { ar: 'ذهبية', fr: 'Dahabiya' },
  CREDIT: { ar: 'كريدي', fr: 'Crédit' },
};

/** Lookup lines + full fiscal head → printable Sale (DZD units). */
function detailToSale(d: SalesBookDetail): Sale {
  const h = d.head;
  const n = (k: string) => Number(h[k] ?? 0);
  return {
    id: String(h.id), invoice_number: String(h.invoice_number), ticket_number: String(h.ticket_number),
    cashier_id: String(h.cashier_id ?? ''), cashier_name: String(h.cashier_name ?? ''),
    client_id: h.client_id == null ? undefined : Number(h.client_id),
    client_name: (h.client_name as string | null) ?? undefined,
    items: d.items.map(it => ({
      product_id: it.product_id ?? 0, barcode: it.barcode, name_fr: it.name_fr, name_ar: it.name_ar,
      unit_price_ttc: it.unit_price_ct / 100, quantity: it.qty_milli / 1000,
      unit: it.unit as 'PIECE' | 'KG' | 'LITRE', tva_rate: it.tva_rate as 0 | 9 | 19,
      discount_percent: 0,
      total_line_ht: 0, total_line_tva: 0, total_line_ttc: it.line_ttc_ct / 100,
    })),
    total_ht: n('total_ht_ct') / 100,
    tva_breakdown: {
      0: { rate: 0 as const, base_ht: n('tva0_base_ct') / 100, tva_amount: n('tva0_amt_ct') / 100, total_ttc: n('tva0_ttc_ct') / 100 },
      9: { rate: 9 as const, base_ht: n('tva9_base_ct') / 100, tva_amount: n('tva9_amt_ct') / 100, total_ttc: n('tva9_ttc_ct') / 100 },
      19: { rate: 19 as const, base_ht: n('tva19_base_ct') / 100, tva_amount: n('tva19_amt_ct') / 100, total_ttc: n('tva19_ttc_ct') / 100 },
    },
    total_tva: n('total_tva_ct') / 100, timbre_fiscal: n('timbre_ct') / 100, total_ttc: n('total_ttc_ct') / 100,
    payment_method: h.payment_method as Sale['payment_method'],
    amount_paid: n('amount_paid_ct') / 100, amount_returned: n('amount_returned_ct') / 100,
    status: h.status as 'COMPLETED' | 'CANCELLED', created_at: String(h.created_at),
    fiscal_regime: { tva_enabled: n('tva_enabled') !== 0, timbre_enabled: n('timbre_enabled') !== 0 },
  };
}

export const SalesBookView: React.FC = () => {
  const { language, session } = useApp();
  const isAr = language === 'ar';
  const actor = session?.username ?? '';

  const [day, setDay] = useState(() => fiscalDayISO(new Date()));
  const [rows, setRows] = useState<SalesBookRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [jump, setJump] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SalesBookDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [dupReason, setDupReason] = useState('');
  const [dupBusy, setDupBusy] = useState(false);
  const [dupSale, setDupSale] = useState<Sale | null>(null);
  const [filters, setFilters] = useState<SalesBookFilters>(EMPTY_SALES_BOOK_FILTERS);
  const [z, setZ] = useState<ZDaySummary | null>(null);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailErr(null);
    setDetail(null);
    setDupSale(null);
    const d = await getSalesBookDetail(id);
    if (!d) { const { lastSalesBookError } = await import('../../core/sales-book-authority'); setDetailErr(lastSalesBookError()); return; }
    setDetail(d);
  }, []);

  const load = useCallback(async (d: string) => {
    setErr(null);
    setRows(null);
    setZ(null);
    setDetail(null);
    setDetailErr(null);
    setDupSale(null);
    setSelectedId(null);
    const [out, zsum] = await Promise.all([listSalesDay(d), fetchZDaySummary(d)]);
    if (!out) { const { lastSalesBookError } = await import('../../core/sales-book-authority'); setErr(lastSalesBookError()); return; }
    setRows(out);
    setZ(zsum);
    // The desk opens on the newest receipt: the detail dock is never empty.
    if (out.length > 0) void openDetail(out[0].id);
  }, [openDetail]);
  useEffect(() => { void load(day); }, [day, load]);

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
      const raw = lastSalesBookError() ?? '';
      // Zero-Trust stays shut: map the transport refusal to a human sentence.
      setDetailErr(
        /401|token/i.test(raw)
          ? (isAr ? 'تعذّر تسجيل الطبع: هذه الجلسة بلا تصريح كتابة — الطبع المحوكم في نسخة الصندوق المثبتة.' : 'Enregistrement impossible : session sans droit d’écriture — duplicata réservé à la caisse installée.')
          : raw || (isAr ? 'تعذّر تسجيل الطبع.' : 'Enregistrement impossible.'),
      );
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

  const timeOf = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
        {/* P4 · Day health: gross − AVOIR = net, per-method split. */}
        {health && (health.count > 0 || health.cancelled > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {[
              { l: isAr ? 'المجموع' : 'Brut', v: health.gross_ct, c: 'text-white' },
              { l: 'AVOIR', v: health.avoir_ct, c: 'text-amber-300' },
              { l: isAr ? 'الصافي' : 'Net', v: health.net_ct, c: 'text-emerald-300' },
              { l: isAr ? 'نقدي' : 'Espèces', v: health.especes_ct, c: 'text-slate-300' },
              { l: isAr ? 'بنكي + كريدي' : 'Banque + crédit', v: health.bank_ct + health.credit_ct, c: 'text-slate-300' },
            ].map(k => (
              <div key={k.l} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-2 py-2">
                <div className="text-[11px] text-slate-500 font-bold">{k.l}</div>
                <div className={`font-mono font-black text-sm ${k.c}`} dir="ltr">{formatDZDFromCt(k.v)}</div>
              </div>
            ))}
          </div>
        )}
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

      {/* 02 · Master/detail: the list scrolls inside its dock, the receipt
          stays pinned on the side — no page-bottom chase on long days. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
        <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">02</span>
            <Receipt className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-black text-white">{isAr ? 'وصولات اليوم — اختر وصلًا' : 'Tickets du jour — choisissez'}</h3>
            {filtered && (
              <span className="ms-auto text-[11px] font-bold text-slate-400" dir="ltr">{filtered.length}</span>
            )}
          </div>
          {/* Column header (desktop): mirrors the UltraPOS desk. */}
          <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_64px_minmax(0,1fr)_86px_64px_minmax(0,0.8fr)] gap-2 px-3 text-[11px] font-black text-slate-500 uppercase tracking-wide" dir="ltr">
            <span className={isAr ? 'text-right' : 'text-left'}>{isAr ? 'الوصل' : 'N° document'}</span>
            <span className="text-center">{isAr ? 'الساعة' : 'Heure'}</span>
            <span>{isAr ? 'الكاشير / الزبون' : 'Caissier / Client'}</span>
            <span>{isAr ? 'الدفع' : 'Paiement'}</span>
            <span className="text-center">{isAr ? 'أسطر' : 'Articles'}</span>
            <span className="text-end">{isAr ? 'المجموع' : 'Total TTC'}</span>
          </div>
          <div className="space-y-2 max-h-[62vh] overflow-y-auto pe-1" data-testid="sales-list">
          {rows === null && !err && <p className="text-xs text-slate-500">{isAr ? 'جارٍ التحميل…' : 'Chargement…'}</p>}
          {rows && rows.length === 0 && (
            <p className="text-xs text-slate-500 border border-dashed border-[#2b3a4f] rounded-xl px-3 py-4 text-center">
              {isAr ? 'لا مبيعات في هذا اليوم.' : 'Aucune vente ce jour.'}
            </p>
          )}
          {filtered && filtered.length === 0 && rows && rows.length > 0 && (
            <p className="text-xs text-slate-500 border border-dashed border-[#2b3a4f] rounded-xl px-3 py-4 text-center">
              {isAr ? 'لا نتائج بهذه الفلاتر.' : 'Aucun résultat avec ces filtres.'}{' '}
              <button type="button" onClick={() => setFilters(EMPTY_SALES_BOOK_FILTERS)} className="underline text-emerald-400">
                {isAr ? 'مسح الفلاتر' : 'Effacer les filtres'}
              </button>
            </p>
          )}
          {filtered?.map(r => {
            const active = r.id === selectedId;
            return (
            <button key={r.id} type="button" onClick={() => void openDetail(r.id)}
              aria-current={active}
              className={`w-full rounded-xl px-3 py-2.5 text-sm text-start cursor-pointer border transition-colors grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_64px_minmax(0,1fr)_86px_64px_minmax(0,0.8fr)] gap-x-2 gap-y-1 items-center ${active ? 'bg-emerald-600/10 border-emerald-500/60' : 'bg-[#0b0f17] border-[#2b3a4f] hover:border-emerald-500/50'}`}>
              <span className="min-w-0">
                <span className="block font-mono font-bold text-emerald-300 truncate" dir="ltr">{r.invoice_number}</span>
                <span className="block text-xs text-slate-500 truncate">{r.cashier_name}{r.client_name ? ` · ${r.client_name}` : ''}</span>
              </span>
              <span className="md:hidden font-bold text-white font-mono" dir="ltr">{formatDZDFromCt(r.total_ttc_ct)}</span>
              <span className="hidden md:block font-mono text-slate-400 text-xs" dir="ltr">{timeOf(r.created_at)}</span>
              <span className="hidden md:block text-xs text-slate-400 truncate">{r.cashier_name}{r.client_name ? <span className="text-slate-500"> · {r.client_name}</span> : ''}</span>
              <span className="hidden md:flex text-xs text-slate-400 items-center gap-1">
                {PAY_LABEL[r.payment_method]?.[isAr ? 'ar' : 'fr'] ?? r.payment_method}
                {r.status !== 'COMPLETED' && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-900 text-red-200">
                    {isAr ? 'ملغاة' : 'ANNULÉE'}
                  </span>
                )}
                {r.has_approved_return === 1 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-900 text-amber-200 inline-flex items-center gap-0.5">
                    <Undo2 className="w-2.5 h-2.5" /> AVOIR
                  </span>
                )}
              </span>
              <span className="hidden md:block text-center font-mono text-slate-300 text-xs" dir="ltr">{r.item_count}</span>
              <span className="hidden md:block text-end font-bold text-white font-mono" dir="ltr">{formatDZDFromCt(r.total_ttc_ct)}</span>
            </button>
            );
          })}
          </div>
        </section>

        {/* 03 · Side dock: the receipt never leaves the viewport. */}
        <aside data-testid="sales-detail" className="lg:sticky lg:top-4 bg-[#111722] border border-emerald-500/25 rounded-2xl p-4 space-y-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">03</span>
            <Receipt className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-black text-white">{isAr ? 'تفاصيل الوصل' : 'Détail du ticket'}</h3>
            {(detail || detailErr) && (
              <button type="button" onClick={closeDetail}
                className="ms-auto p-1.5 rounded-lg border border-[#2b3a4f] text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            )}
          </div>
          {!detail && !detailErr && (
            <p className="text-xs text-slate-500 border border-dashed border-[#2b3a4f] rounded-xl px-3 py-6 text-center">
              {isAr ? 'اختر وصلًا من القائمة لعرض سطوره هنا.' : 'Choisissez un ticket pour voir ses lignes ici.'}
            </p>
          )}
          {detailErr && <p className="text-xs text-red-300 font-bold">{detailErr}</p>}
          {detail && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-mono font-bold text-emerald-300" dir="ltr">{String(detail.head.invoice_number)}</span>
                <span className="font-mono text-slate-400 text-xs" dir="ltr">{String(detail.head.ticket_number)}</span>
                <span className="text-xs text-slate-400">{String(detail.head.cashier_name)} · {new Date(String(detail.head.created_at)).toLocaleString(isAr ? 'ar-DZ' : 'fr-FR')}</span>
                <span className="ms-auto font-bold text-white font-mono" dir="ltr">{formatDZDFromCt(Number(detail.head.total_ttc_ct))}</span>
              </div>
              <div className="space-y-1.5 max-h-[30vh] overflow-y-auto pe-1">
                {detail.items.map(it => (
                  <div key={it.sale_item_id} className="flex items-center gap-2 text-sm bg-[#0b0f17] border border-[#2b3a4f] rounded-lg px-3 py-1.5">
                    <span className="text-slate-200 font-bold truncate">{isAr ? it.name_ar || it.name_fr : it.name_fr}</span>
                    <span className="text-xs text-slate-500 font-mono shrink-0" dir="ltr">{(it.qty_milli / 1000)} × {formatDZD(it.unit_price_ct / 100, false)}</span>
                    {it.returned_milli > 0 && (
                      <span className="text-[11px] font-bold text-amber-300 shrink-0">
                        {isAr ? `مُرجع ${(it.returned_milli / 1000)} / متبقٍ ${(it.remaining_milli / 1000)}` : `retourné ${it.returned_milli / 1000} / reste ${it.remaining_milli / 1000}`}
                      </span>
                    )}
                    <span className="ms-auto font-mono text-slate-200 shrink-0" dir="ltr">{formatDZD(it.line_ttc_ct / 100, false)}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                {[['HT', 'total_ht_ct'], ['TVA', 'total_tva_ct'], ['Timbre', 'timbre_ct'], ['TTC', 'total_ttc_ct']].map(([k, f]) => (
                  <div key={k} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg px-2 py-1.5">
                    <div className="text-slate-500 font-bold">{k}</div>
                    <div className="font-mono font-bold text-white" dir="ltr">{formatDZDFromCt(Number(detail.head[f]))}</div>
                  </div>
                ))}
              </div>
              {/* 03 · Governed duplicata. */}
              <div className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <Copy className="w-3.5 h-3.5 text-emerald-400" />
                  {isAr ? 'Duplicata محوكم — يُسجَّل في التدقيق قبل الطباعة' : 'Duplicata gouverné — audité avant impression'}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input value={dupReason} onChange={e => setDupReason(e.target.value.slice(0, 140))}
                    placeholder={isAr ? 'سبب إعادة الطبع (اختياري)…' : 'Motif (optionnel)…'}
                    className="flex-1 min-w-40 bg-[#162030] border border-[#2b3a4f] rounded-lg px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-emerald-500" />
                  <button type="button" onClick={() => void doDuplicata()} disabled={dupBusy}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer">
                    <Printer className="w-4 h-4" />
                    {dupBusy ? '…' : (isAr ? 'طبع Duplicata' : 'Imprimer duplicata')}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">{isAr ? `يُسجَّل باسم ${actor || '—'}. لا نسخ صامتة أبدًا.` : `Audité au nom de ${actor || '—'}. Jamais de copie silencieuse.`}</p>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Governed reprint preview. */}
      {dupSale && (
        <TicketThermal80mm sale={dupSale} duplicata onClose={() => setDupSale(null)} />
      )}
    </div>
  );
};
