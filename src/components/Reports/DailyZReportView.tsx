import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import { formatDZD, formatDZDFromCt } from '../../core/display';
import { dzdToCentimes } from '../../core/money';
import { commitZClose, fetchDailyZ, zListNative, fetchLossesWindow, LOOPBACK_BASE } from '../../core/fiscal-authority';
import { GENESIS_PREV_HASH, previewChainHash } from '../../core/zreport';
import { mapStoredDayRow } from '../../core/z-dayrow';
import { ZPrintPreview } from './ZPrintPreview';
import { fiscalDayISO, fiscalDayBoundsUTC } from '../../core/fiscal-day';
import { listReturns } from '../../core/returns-authority';
import {
  FileText,
  Printer,
  DollarSign,
  CreditCard,
  BookOpen,
  ArrowDownLeft,
  Percent,
  Lock,
  Ban,
} from 'lucide-react';

export const DailyZReportView: React.FC = () => {
  const { generateDailyZReport, sales, settlements, expenses, storeProfile, language, session, voidSale } = useApp();
  const isAr = language === 'ar';
  const canVoid = can(session?.role ?? 'cashier', 'sale.void');
  const canClose = can(session?.role ?? 'cashier', 'z.close');

  // Z3-fix: the report is LIVE — recomputed whenever today's sales or
  // settlements change (mount-once state used to freeze the close payload).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const zReport = useMemo(() => generateDailyZReport(), [sales, settlements]);
  const [voidTargetId, setVoidTargetId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [format, setFormat] = useState<'80mm' | 'A4'>('80mm');
  const [prevHash, setPrevHash] = useState<string>(GENESIS_PREV_HASH);
  const [closure, setClosure] = useState<{ report_number: string; hash: string } | null>(null);
  const [closedRow, setClosedRow] = useState<{ report_number: string; closing_time: string; hash: string; prev_hash: string } | null>(null);
  const [dayLocked, setDayLocked] = useState(false);
  // #004: full stored DAY row (centimes) — the ticket reprints from this,
  // never from live state, once the day is locked.
  const [dayRow, setDayRow] = useState<{
    salesCount: number; ht: number; b0: number; b9: number; a9: number;
    b19: number; a19: number; tva: number; timbre: number; ttc: number;
    esp: number; bank: number; cred: number; coll: number;
    first: string; last: string;
  } | null>(null);
  // MKT-009 (MED): all stored DAY rows for day navigation (reprint).
  const [dayRows, setDayRows] = useState<Record<string, unknown>[]>([]);
  // MKT-009: viewed day — null = today (live). A stored day = locked reprint.
  const [viewDay, setViewDay] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  // P0b: lane-verified count — distinguishes "no sales" from "not loaded".
  // null = lane unreachable here (honest unknown), never asserted as zero.
  const [laneCount, setLaneCount] = useState<number | null>(null);
  /** ADR-047: lane-truth below-available sales for the day (null = unknown). */
  const [laneShort, setLaneShort] = useState<{ n: number; ttcCt: number } | null>(null);

  // #004/MKT-009: apply a stored DAY row as a locked reprint (component-level
  // so the day navigator reuses the exact mount path — one mapping, no drift).
  const applyStoredDay = (day: Record<string, unknown>) => {
    setClosedRow({ report_number: String(day.report_number ?? ''), closing_time: String(day.closing_time ?? ''), hash: String(day.hash ?? ''), prev_hash: String(day.prev_hash ?? '') });
    setDayRow(mapStoredDayRow(day));
    setClosure({ report_number: String(day.report_number ?? ''), hash: String(day.hash ?? '') });
    setPrevHash(String(day.prev_hash ?? ''));
    setDayLocked(true);
    setCloseNote(isAr ? 'اليوم مقفل قانونياً — إعادة طباعة من السجل' : 'Jour verrouillé — réimpression depuis le registre');
  };

  // #004: probe the legal day-lock on mount. v1.4.9 (#PROD-LOCAL): the native
  // z_list is the registry in the installed app (reprint + chain after
  // restart); the :3100 fetches stay as the browser-dev fallback.
  useEffect(() => {
    let alive = true;
    zListNative().then(z => {
      if (!alive || !z) return false;
      if (z.prev_hash) setPrevHash(z.prev_hash);
      // MKT-009: keep every stored DAY row for the day navigator.
      setDayRows(z.rows.filter(r => r.close_kind === 'DAY' && typeof r.report_number === 'string'));
      const day = z.rows.find(r => r.day === zReport.date && r.close_kind === 'DAY');
      if (day && typeof day.report_number === 'string') applyStoredDay(day);
      return true;
    }).catch(() => false).then(nativeDone => {
      if (!alive || nativeDone) { return; }
      // P0d: loopback parity lives in zListNative — no raw view-level fetch.
      fetch(`${LOOPBACK_BASE}/api/z/latest-hash`)
      .then(r => (r.ok ? r.json() : null))
      .then((j: { prev_hash?: string } | null) => {
        if (alive && j?.prev_hash) setPrevHash(j.prev_hash);
      })
      .catch(() => {});
      zListNative().then(z => {
        if (!alive || !z) return;
        if (z.prev_hash) setPrevHash(z.prev_hash);
        // MKT-009: keep every stored DAY row for the day navigator.
        setDayRows(z.rows.filter(r => r.close_kind === 'DAY' && typeof r.report_number === 'string'));
        const day = z.rows.find(r => r.day === zReport.date && r.close_kind === 'DAY');
        if (day && typeof day.report_number === 'string') applyStoredDay(day);
      }).catch(() => {});
    });
    fetchDailyZ(zReport.date)
      .then(z => {
        if (!alive) return;
        if (z?.closed) setDayLocked(true);
        // P0b: lane-verified count (null when the lane is down — unknown).
        if (z && typeof z.sales_count === 'number') setLaneCount(z.sales_count);
        else setLaneCount(null);
        // ADR-047: below-available disclosure (lane truth; hidden when unknown).
        if (z && typeof z.short_count === 'number') setLaneShort({ n: z.short_count, ttcCt: z.short_total_ttc_ct ?? 0 });
        else setLaneShort(null);
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ct = useMemo(() => ({
    ht: dzdToCentimes(zReport.total_ht),
    tva: dzdToCentimes(zReport.total_tva),
    timbre: dzdToCentimes(zReport.total_timbre),
    ttc: dzdToCentimes(zReport.total_ttc),
    b0: dzdToCentimes(zReport.tva_0_base),
    b9: dzdToCentimes(zReport.tva_9_base),
    a9: dzdToCentimes(zReport.tva_9_amount),
    b19: dzdToCentimes(zReport.tva_19_base),
    a19: dzdToCentimes(zReport.tva_19_amount),
    esp: dzdToCentimes(zReport.total_especes),
    cib: dzdToCentimes(zReport.total_cib_dahabiya),
    cred: dzdToCentimes(zReport.total_credit_granted),
    coll: dzdToCentimes(zReport.total_credit_settled),
  }), [zReport]);

  const todayInvoices = useMemo(() => sales
    // F2: compare LOCAL fiscal days, never the UTC prefix.
    .filter(s => fiscalDayISO(new Date(s.created_at)) === zReport.date && s.status === 'COMPLETED' && !s.is_provisional)
    .map(s => s.invoice_number)
    .sort(), [sales, zReport.date]);
  const firstInvoice = todayInvoices[0] ?? '—';
  const lastInvoice = todayInvoices[todayInvoices.length - 1] ?? '—';

  // #004: ticket values — the stored DAY row once locked (reprint), live
  // aggregates before the close. Cards above always stay live (management).
  const tv = dayRow ?? {
    salesCount: zReport.sales_count, ht: ct.ht, b0: ct.b0, b9: ct.b9, a9: ct.a9,
    b19: ct.b19, a19: ct.a19, tva: ct.tva, timbre: ct.timbre, ttc: ct.ttc,
    esp: ct.esp, bank: ct.cib, cred: ct.cred, coll: ct.coll,
    first: firstInvoice, last: lastInvoice,
  };
  // Z10-fix: no fake closing time on an open day — '…' until FINALISÉ.
  const tvClosedAt = closedRow?.closing_time ?? '…';
  const tvReportNo = closure ? closure.report_number : zReport.report_number;

  // #003: today's rows for the legal-void surface (COMPLETED voids first,
  // CANCELLED rows stay visible as the journal — never deleted).
  const todaySales = useMemo(() => sales
    .filter(s => fiscalDayISO(new Date(s.created_at)) === zReport.date)
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at)), [sales, zReport.date]);

  const confirmVoid = async (): Promise<void> => {
    if (!voidTargetId) return;
    setVoidBusy(true);
    setVoidError('');
    try {
      await voidSale(voidTargetId, voidReason);
      setVoidTargetId(null);
      setVoidReason('');
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : String(e));
    } finally {
      setVoidBusy(false);
    }
  };

  // Z2/Z6-fix: ONE display rule — closed shows the stored server hash,
  // open shows a provisional preview over the DISPLAYED number.
  // MKT-009: the viewed day drives the chain (stored totals when reprinting).
  const viewDate = viewDay ?? zReport.date;
  const chainMeta = previewChainHash({
    closureHash: closure?.hash ?? null,
    prevHash, reportNumber: tvReportNo, date: viewDate,
    totalTtcCt: dayRow?.ttc ?? ct.ttc, totalTimbreCt: dayRow?.timbre ?? ct.timbre,
  });
  const chainHash = chainMeta.hash;

  /** MKT-009 (MED): switch to a stored day — locked reprint, close disabled. */
  const selectDay = (day: string): void => {
    if (day === zReport.date) { backToToday(); return; }
    const row = dayRows.find(r => String(r.day) === day);
    if (!row) return;
    setViewDay(day);
    applyStoredDay(row);
  };

  /** MKT-009: back to today — live, unless today itself is legally locked. */
  const backToToday = (): void => {
    setViewDay(null);
    const today = dayRows.find(r => String(r.day) === zReport.date);
    if (today) { applyStoredDay(today); return; }
    setDayRow(null); setClosedRow(null); setClosure(null);
    setDayLocked(false);
    setCloseNote('');
  };

  const handlePrintZ = () => {
    window.print();
  };

  /** #004: finalize via the legal close lane (invoke → loopback). */
  const handleClose = async () => {
    if (dayLocked || closedRow) {
      setCloseNote(isAr ? 'اليوم مقفل قانونياً — الإغلاق مرفوض' : 'Jour déjà verrouillé — clôture refusée');
      return;
    }
    // DAY-LOCK is irreversible and freezes EVERY new sale for this fiscal day.
    // A mistap here is the #1 way a till fills its outbox with refused sales.
    const ok = window.confirm(isAr
      ? `إغلاق Z نهائي ليوم ${zReport.date}؟\n• يُجمَّد اليوم قانونياً ولا يمكن التراجع.\n• كل بيع جديد بعده سيُرفض ويبقى في الطابور الصادر.\n• أغلق الوردية (Clôture) أولاً إذا كان الهدف نهاية الدوام فقط.`
      : `Clôturer DÉFINITIVEMENT le Z du ${zReport.date} ?\n• Le jour est gelé légalement, sans retour.\n• Toute vente ultérieure sera refusée (file sortante).\n• Utilisez Clôture d'abord si c'est une simple fin de service.`);
    if (!ok) return;
    setClosing(true);
    setCloseNote('');
    try {
      const closingTime = new Date().toLocaleTimeString('fr-FR');
      // v1.5.0/A3: the legal lane cross-checks caller totals against ITS
      // ledger — the caller must carry the returns + scrappage memo, summed
      // over the same windows the DAL aggregates (posting_day / UTC window).
      let returnsCount = 0, returnsTotalTtcCt = 0, lossesCount = 0, lossesTotalCt = 0;
      try {
        const approved = await listReturns('APPROVED');
        for (const r of approved ?? []) {
          if (r.posting_day === zReport.date) {
            returnsCount += 1;
            returnsTotalTtcCt += r.refund_ct;
          }
        }
      } catch { /* memo fetch failure surfaces as a ledger mismatch, never a fake zero */ }
      try {
        // P0d: lane-owned scrappage window (loopback-only by design).
        const { start, end } = fiscalDayBoundsUTC(zReport.date);
        const rows = await fetchLossesWindow(start, end);
        for (const row of rows) {
          if (typeof row.created_at === 'string' && row.created_at >= start && row.created_at < end) {
            lossesCount += 1;
            lossesTotalCt += Number(row.total_loss_ct ?? 0);
          }
        }
      } catch { /* same: mismatch refusal, never a fake zero */ }
      const out = await commitZClose(zReport.date, '08:00', closingTime, {
        salesCount: zReport.sales_count, totalHtCt: ct.ht, tva0BaseCt: ct.b0,
        tva9BaseCt: ct.b9, tva9AmtCt: ct.a9, tva19BaseCt: ct.b19, tva19AmtCt: ct.a19,
        totalTvaCt: ct.tva, totalTimbreCt: ct.timbre, totalTtcCt: ct.ttc,
        especesGrossCt: ct.esp, cibTotalCt: ct.cib, dahabiyaTotalCt: 0,
        creditGrantedCt: ct.cred, creditCollectedCt: ct.coll,
        firstInvoice, lastInvoice,
        returnsCount, returnsTotalTtcCt, lossesCount, lossesTotalCt,
      });
      if (!out) throw new Error('lane');
      setClosure({ report_number: out.report_number, hash: out.hash });
      setClosedRow({ report_number: out.report_number, closing_time: closingTime, hash: out.hash, prev_hash: out.prev_hash });
      setPrevHash(out.prev_hash);
      setDayLocked(true);
      setCloseNote(isAr ? 'تم الإغلاق والتوقيع في SQLite' : 'Clôturé et signé en SQLite');
    } catch {
      setCloseNote(isAr
        ? 'تعذّر الإغلاق: اليوم مقفل أو المجاميع لا تطابق الدفتر أو المسار الجبائي غائب'
        : 'Clôture impossible : jour verrouillé, totaux divergents ou voie fiscale absente');
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100dvh-80px)] bg-[#0b0f17] p-4 gap-6 overflow-y-auto">
      {/* Left: Interactive Dashboard & Fiscal Breakdown Summary */}
      <div className="flex-1 space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-400" />
              <span>{isAr ? 'تقرير الإغلاق المالي والجبائي اليومي (Rapport Z de Caisse)' : 'Rapport Z de Clôture Journalière'}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isAr
                ? 'مطابق لمعايير المراقبة الجبائية للمديرية العامة للضرائب (DGI)'
                : 'Conforme aux normes de contrôle fiscal DGI et traçabilité'}
            </p>
            {/* P0b: lane-verified vs memory — never assert zeros as truth. */}
            {laneCount !== null && laneCount !== zReport.sales_count && (
              <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1 mt-1.5">
                {isAr
                  ? `تنبيه: الذاكرة المحلية تعرض ${zReport.sales_count} بينما الدفتر يؤكد ${laneCount} — الأرقام المعروضة غير مؤكدة بعد`
                  : `Alerte : mémoire locale ${zReport.sales_count}, registre ${laneCount} — chiffres non confirmés`}
              </p>
            )}
            {/* ADR-047: mandatory below-available disclosure (lane truth). */}
            {laneShort !== null && laneShort.n > 0 && (
              <p className="text-[11px] text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-lg px-2.5 py-1 mt-1.5 font-mono" dir="ltr">
                {isAr
                  ? `مبيعات على المكشوف: ${laneShort.n} — ${formatDZDFromCt(laneShort.ttcCt)} (بأساس آخر سعر شراء)`
                  : `Ventes à découvert: ${laneShort.n} — ${formatDZDFromCt(laneShort.ttcCt)} (au dernier coût d'achat)`}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
          {/* MKT-009 (MED): day navigator — stored days reprint locked. */}
          <select
            value={viewDate}
            onChange={e => selectDay(e.target.value)}
            className="px-2 py-2 bg-[#111722] border border-[#2b3a4f] text-slate-200 rounded-xl text-[11px] font-mono cursor-pointer"
            title={isAr ? 'اختر يوماً لإعادة طباعته من السجل' : 'Choisir un jour à réimprimer'}
          >
            <option value={zReport.date}>{isAr ? 'اليوم' : "Aujourd'hui"} · {zReport.date}</option>
            {dayRows.filter(r => String(r.day) !== zReport.date).map(r => String(r.day)).map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <div className="flex rounded-lg overflow-hidden border border-[#2b3a4f] text-[11px]">
            {(['80mm', 'A4'] as const).map(f => (
              <button key={f} onClick={() => setFormat(f)} className={`px-2.5 py-1.5 cursor-pointer ${format === f ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'}`}>{f}</button>
            ))}
          </div>
          <button
            onClick={() => void handleClose()}
            disabled={closing || !!closure || dayLocked || !canClose}
            title={!canClose ? (isAr ? 'الإغلاق للمدير فأعلى' : 'Clôture réservée au gérant+') : undefined}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            <span>{closure ? (isAr ? 'مغلق ✓' : 'Clôturé ✓') : closing ? '…' : (isAr ? 'إغلاق Z' : 'Clôturer Z')}</span>
          </button>
          <button
            onClick={handlePrintZ}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{isAr ? 'طباعة تقرير Z' : 'Imprimer Ticket Z'}</span>
          </button>
          </div>
        </div>

        {/* Global Financial Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 font-semibold uppercase">{isAr ? 'إجمالي المبيعات TTC' : 'Chiffre Affaires TTC'}</span>
            <div className="text-xl font-black text-emerald-400 font-mono mt-1">
              {formatDZD(zReport.total_ttc, false)}
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              {zReport.sales_count} {isAr
                ? (zReport.sales_count === 1 ? 'عملية بيع اليوم' : 'عمليات بيع اليوم')
                : (zReport.sales_count === 1 ? 'vente enregistrée' : 'ventes enregistrées')}
            </span>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 font-semibold uppercase">{isAr ? 'المجموع بدون ضرائب HT' : 'Total Hors Taxes (HT)'}</span>
            <div className="text-xl font-black text-white font-mono mt-1">
              {formatDZD(zReport.total_ht, false)}
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">{isAr ? 'وعاء الضريبة الإجمالي' : 'Base imposable globale'}</span>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 font-semibold uppercase">{isAr ? 'مجموع الرسم TVA' : 'Total TVA Collectée'}</span>
            <div className="text-xl font-black text-amber-400 font-mono mt-1">
              {formatDZD(zReport.total_tva, false)}
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">TVA 0%, 9%, 19%</span>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 font-semibold uppercase">{isAr ? 'حق الطابع المالي' : 'Timbre Fiscal (Espèces)'}</span>
            <div className="text-xl font-black text-amber-300 font-mono mt-1">
              {formatDZD(zReport.total_timbre, false)}
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">{isAr ? 'المادة 136 قانون الطابع' : 'Art. 136 Code du Timbre'}</span>
          </div>

          {/* P2 (v1.4.4): day expenses justify the till gap. Z4-fix: honest split —
              only till-posted money left the drawer; hors-caisse never touched Z. */}
          <div className="bg-[#111722] border border-amber-600/30 rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 font-semibold uppercase">{isAr ? 'مصاريف اليوم (تبرر الفرق)' : 'Dépenses du jour'}</span>
            {(() => {
              const dayExp = expenses.filter(e => e.date === zReport.date);
              const tillCt = dayExp.filter(e => e.tillPosted).reduce((s, e) => s + e.amountCt, 0);
              const horsCt = dayExp.filter(e => !e.tillPosted).reduce((s, e) => s + e.amountCt, 0);
              return (
                <>
                  <div className="text-xl font-black text-amber-300 font-mono mt-1">
                    {formatDZD((tillCt + horsCt) / 100, false)}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    {dayExp.length} {isAr ? 'مصروف' : 'dépenses'} — {isAr ? 'من الصندوق:' : 'caisse:'} <strong dir="ltr">{formatDZD(tillCt / 100, false)}</strong>
                    {' • '}{isAr ? 'خارج الصندوق:' : 'hors-caisse:'} <strong dir="ltr">{formatDZD(horsCt / 100, false)}</strong>
                  </span>
                </>
              );
            })()}
          </div>
        </div>

        {/* TVA Breakdown Table by Tax Rate */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Percent className="w-4 h-4 text-emerald-400" />
            <span>{isAr ? 'تفصيل الأوعية والمبالغ الضريبية (TVA Breakdown)' : 'Ventilation de la TVA par Taux'}</span>
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead>
                <tr className="bg-[#0b0f17] text-slate-400 uppercase text-[10px] font-semibold border-b border-[#1e293b]">
                  <th className="py-2.5 px-3 text-start">{isAr ? 'نسبة الرسم' : 'Taux TVA'}</th>
                  <th className="py-2.5 px-3 text-end">{isAr ? 'الوعاء الخاضع (Base HT)' : 'Assiette HT (DZD)'}</th>
                  <th className="py-2.5 px-3 text-end">{isAr ? 'مبلغ الرسم (TVA)' : 'Montant TVA (DZD)'}</th>
                  <th className="py-2.5 px-3 text-end">{isAr ? 'المجموع شامل الرسم (TTC)' : 'Total TTC (DZD)'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#162030] font-mono text-slate-300">
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-sky-400">0% ({isAr ? 'معفى قانوناً' : 'Exonéré'})</td>
                  <td className="py-2.5 px-3 text-end">{formatDZD(zReport.tva_0_base, false)}</td>
                  <td className="py-2.5 px-3 text-end text-slate-500">0.00 DZD</td>
                  <td className="py-2.5 px-3 text-end font-bold">{formatDZD(zReport.tva_0_base, false)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-amber-400">9% ({isAr ? 'المعدل المنخفض' : 'Taux Réduit'})</td>
                  <td className="py-2.5 px-3 text-end">{formatDZD(zReport.tva_9_base, false)}</td>
                  <td className="py-2.5 px-3 text-end text-amber-300">+{formatDZD(zReport.tva_9_amount, false)}</td>
                  <td className="py-2.5 px-3 text-end font-bold">{formatDZD(zReport.tva_9_base + zReport.tva_9_amount, false)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-purple-400">19% ({isAr ? 'المعدل العام' : 'Taux Normal'})</td>
                  <td className="py-2.5 px-3 text-end">{formatDZD(zReport.tva_19_base, false)}</td>
                  <td className="py-2.5 px-3 text-end text-purple-300">+{formatDZD(zReport.tva_19_amount, false)}</td>
                  <td className="py-2.5 px-3 text-end font-bold">{formatDZD(zReport.tva_19_base + zReport.tva_19_amount, false)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment Methods Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span>{isAr ? 'المحصل نقداً في الصندوق:' : 'Espèces en Caisse:'}</span>
            </div>
            <div className="text-lg font-black font-mono text-emerald-400 mt-1">
              {formatDZD(zReport.total_especes, false)}
            </div>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <CreditCard className="w-4 h-4 text-amber-400" />
              <span>{isAr ? 'الذهبية / CIB:' : 'Carte Dahabiya / CIB:'}</span>
            </div>
            <div className="text-lg font-black font-mono text-amber-400 mt-1">
              {formatDZD(zReport.total_cib_dahabiya, false)}
            </div>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <BookOpen className="w-4 h-4 text-rose-400" />
              <span>{isAr ? 'ديون جديدة (كريدي اليوم):' : 'Crédit Accordé:'}</span>
            </div>
            <div className="text-lg font-black font-mono text-rose-400 mt-1">
              {formatDZD(zReport.total_credit_granted, false)}
            </div>
          </div>
        </div>

        {/* #003: legal-void surface — manager+ only. CANCELLED rows stay as
            the journal; the fiscal lane (invoke → loopback) owns the flip. */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
            <Ban className="w-4 h-4 text-rose-400" />
            <span>{isAr ? 'فواتير اليوم — إلغاء قانوني' : 'Factures du jour — annulation légale'}</span>
          </h3>
          <p className="text-[11px] text-slate-500 mb-3">
            {dayLocked || closedRow
              ? (isAr
                ? 'اليوم مقفل قانونياً (Z FINALISÉ) — الإلغاء مرفوض، السجل للقراءة فقط.'
                : 'Jour légalement verrouillé (Z FINALISÉ) — annulation refusée, journal en lecture seule.')
              : (isAr
                ? 'الإلغاء يبقي السطر ويوثق السبب — لا حذف أبداً. يتطلب اتصال المسار الجبائي.'
                : 'L’annulation conserve la ligne et journalise le motif — jamais de suppression. Exige la voie fiscale.')}
          </p>
          {todaySales.length === 0 && (
            <div className="text-xs text-slate-500">{isAr ? 'لا فواتير اليوم بعد.' : 'Aucune facture aujourd’hui.'}</div>
          )}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {todaySales.map(s => (
              <div key={s.id} className="flex items-center gap-2 bg-[#0b0f17] border border-[#1e293b] rounded-xl px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono font-bold text-slate-200 truncate">{s.invoice_number}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{formatDZD(s.total_ttc, false)} · {s.payment_method}</div>
                </div>
                {s.status === 'CANCELLED' ? (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-950/60 text-rose-300 border border-rose-900/60">
                    {isAr ? 'ملغاة' : 'ANNULÉE'}
                  </span>
                ) : s.is_provisional ? (
                  // Z5-fix: a DRAFT row is not fiscal yet — no lane can void it.
                  <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-950/60 text-amber-300 border border-amber-900/60" title={isAr ? 'مؤقت — ليس بعد في الدفتر الجبائي' : 'Provisoire — pas encore au journal fiscal'}>
                    {isAr ? 'مؤقت' : 'PROV'}
                  </span>
                ) : (dayLocked || closedRow) ? (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800/60 text-slate-400 border border-slate-700/60" title={isAr ? 'اليوم مقفل قانونياً' : 'Jour verrouillé'}>
                    <Lock className="w-3 h-3 inline" />
                  </span>
                ) : canVoid ? (
                  voidTargetId === s.id ? (
                    <div className="flex items-center gap-1.5 flex-1 max-w-[260px]">
                      <input
                        value={voidReason}
                        onChange={e => setVoidReason(e.target.value)}
                        placeholder={isAr ? 'السبب (إلزامي)…' : 'Motif (obligatoire)…'}
                        className="flex-1 min-w-0 bg-[#111722] border border-rose-900/60 rounded-lg px-2 py-1.5 text-[11px] text-white placeholder:text-slate-600 outline-none focus:border-rose-500"
                        disabled={voidBusy}
                      />
                      <button
                        onClick={() => void confirmVoid()}
                        disabled={voidBusy || !voidReason.trim()}
                        className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                      >
                        {isAr ? 'تأكيد' : 'OK'}
                      </button>
                      <button
                        onClick={() => { setVoidTargetId(null); setVoidReason(''); setVoidError(''); }}
                        disabled={voidBusy}
                        className="px-2 py-1.5 text-slate-500 hover:text-slate-300 text-[11px] cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setVoidTargetId(s.id); setVoidReason(''); setVoidError(''); }}
                      className="px-2.5 py-1.5 border border-rose-900/60 text-rose-300 hover:bg-rose-950/50 rounded-lg text-[11px] font-bold cursor-pointer"
                    >
                      {isAr ? 'إلغاء' : 'Annuler'}
                    </button>
                  )
                ) : null}
              </div>
            ))}
          </div>
          {voidError && <div className="mt-2 text-[11px] text-rose-300 font-mono">{voidError}</div>}
        </div>
      </div>

      {/* MKT-009: print preview isolated in ZPrintPreview (memo). */}
      <ZPrintPreview
        format={format} isAr={isAr} tv={tv}
        tvReportNo={tvReportNo} tvClosedAt={tvClosedAt}
        closed={!!closure} chainHash={chainHash} prevHash={prevHash}
        closeNote={closeNote} viewDate={viewDate} storeProfile={storeProfile}
      />
    </div>
  );
};
