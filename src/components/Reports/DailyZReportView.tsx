import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import { formatDZD } from '../../core/display';
import { dzdToCentimes } from '../../core/money';
import { commitZClose, fetchDailyZ } from '../../core/fiscal-authority';
import { GENESIS_PREV_HASH, previewChainHash } from '../../core/zreport';
import { fiscalDayISO } from '../../core/fiscal-day';
import { APP_VERSION } from '../../core/version';
import {
  FileText,
  Printer,
  Calendar,
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
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState('');

  // #004: probe the legal day-lock on mount. Loopback lane reads the stored
  // DAY row (reprint source); exe lane reads the native `closed` flag.
  // Chain head from the SQLite loopback (genesis if offline).
  useEffect(() => {
    let alive = true;
    fetch('http://127.0.0.1:3100/api/z/latest-hash')
      .then(r => (r.ok ? r.json() : null))
      .then((j: { prev_hash?: string } | null) => {
        if (alive && j?.prev_hash) setPrevHash(j.prev_hash);
      })
      .catch(() => {});
    fetch('http://127.0.0.1:3100/api/z/list')
      .then(r => (r.ok ? r.json() : null))
      .then((rows: Array<Record<string, unknown>> | null) => {
        if (!alive || !Array.isArray(rows)) return;
        const day = rows.find(r => r.day === zReport.date && r.close_kind === 'DAY') as
          | { report_number: string; closing_time: string; hash: string; prev_hash: string;
              total_sales_count: number; total_ht_ct: number; tva0_base_ct: number;
              tva9_base_ct: number; tva9_amt_ct: number; tva19_base_ct: number;
              tva19_amt_ct: number; total_tva_ct: number; total_timbre_ct: number;
              total_ttc_ct: number; especes_gross_ct: number; cib_total_ct: number;
              dahabiya_total_ct: number; credit_granted_ct: number; credit_collected_ct: number;
              first_invoice_number: string; last_invoice_number: string } | undefined;
        if (day && typeof day.report_number === 'string') {
          setClosedRow({ report_number: day.report_number, closing_time: day.closing_time, hash: String(day.hash), prev_hash: String(day.prev_hash) });
          setDayRow({
            salesCount: Number(day.total_sales_count), ht: Number(day.total_ht_ct), b0: Number(day.tva0_base_ct),
            b9: Number(day.tva9_base_ct), a9: Number(day.tva9_amt_ct), b19: Number(day.tva19_base_ct),
            a19: Number(day.tva19_amt_ct), tva: Number(day.total_tva_ct), timbre: Number(day.total_timbre_ct),
            ttc: Number(day.total_ttc_ct), esp: Number(day.especes_gross_ct),
            bank: Number(day.cib_total_ct) + Number(day.dahabiya_total_ct),
            cred: Number(day.credit_granted_ct), coll: Number(day.credit_collected_ct),
            first: String(day.first_invoice_number ?? ''), last: String(day.last_invoice_number ?? ''),
          });
          setClosure({ report_number: day.report_number, hash: String(day.hash) });
          setPrevHash(String(day.prev_hash));
          setDayLocked(true);
          setCloseNote(isAr ? 'اليوم مقفل قانونياً — إعادة طباعة من السجل' : 'Jour verrouillé — réimpression depuis le registre');
        }
      })
      .catch(() => {});
    fetchDailyZ(zReport.date)
      .then(z => { if (alive && z?.closed) setDayLocked(true); })
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
  const chainMeta = previewChainHash({
    closureHash: closure?.hash ?? null,
    prevHash, reportNumber: tvReportNo, date: zReport.date,
    totalTtcCt: ct.ttc, totalTimbreCt: ct.timbre,
  });
  const chainHash = chainMeta.hash;
  const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

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
      const out = await commitZClose(zReport.date, '08:00', closingTime, {
        salesCount: zReport.sales_count, totalHtCt: ct.ht, tva0BaseCt: ct.b0,
        tva9BaseCt: ct.b9, tva9AmtCt: ct.a9, tva19BaseCt: ct.b19, tva19AmtCt: ct.a19,
        totalTvaCt: ct.tva, totalTimbreCt: ct.timbre, totalTtcCt: ct.ttc,
        especesGrossCt: ct.esp, cibTotalCt: ct.cib, dahabiyaTotalCt: 0,
        creditGrantedCt: ct.cred, creditCollectedCt: ct.coll,
        firstInvoice, lastInvoice,
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
    <div className="flex flex-col lg:flex-row h-[calc(100vh-80px)] bg-[#0b0f17] p-4 gap-6 overflow-y-auto">
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
          </div>

          <div className="flex items-center gap-2">
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

      {/* Right: print preview — 80mm ESC/POS ticket or A4 audit sheet */}
      <div className={`w-full ${format === 'A4' ? 'lg:flex-1' : 'lg:w-80'} flex flex-col items-center`}>
        <span className="text-xs font-semibold text-slate-400 mb-2">
          {format === 'A4'
            ? (isAr ? 'ورقة التدقيق A4' : 'Feuille d\'audit A4')
            : (isAr ? 'معاينة وصل الإغلاق (Ticket Z 80mm)' : 'Ticket Z ESC/POS 80mm')}
        </span>

        {format === 'A4' ? (
        <div
          id="printable-facture-a4"
          dir="ltr"
          className="w-full max-w-[640px] bg-white text-black p-8 font-mono text-xs leading-relaxed shadow-2xl border border-slate-300 select-text text-start"
          style={{ fontFamily: "'Courier New', Courier, monospace" }}
        >
          <div className="text-center border-b-2 border-black pb-3">
            <div className="font-bold text-lg uppercase">{storeProfile.store_name}</div>
            <div className="text-xs">{storeProfile.company_owner} — {storeProfile.address}</div>
            <div className="text-[11px]">RC: {storeProfile.rc_number} | NIF: {storeProfile.nif_number} | NIS: {storeProfile.nis_number} | AI: {storeProfile.ai_number}</div>
            <div className="font-bold mt-2">RAPPORT Z DE CLÔTURE — {tvReportNo}{closure && ' (FINALISÉ)'}</div>
            {!closure && (
              <div className="text-[11px] font-bold">— PROVISOIRE / غير نهائي —</div>
            )}
            <div className="text-[11px]">Date: {zReport.date} — Clôture: {tvClosedAt} — Ventes: {tv.salesCount}</div>
            <div className="text-[11px]">Factures: {tv.first} → {tv.last}</div>
            </div>
            <table className="w-full my-3 text-[11px]">
              <tbody>
                <tr className="border-b border-black"><td>Total HT</td><td className="text-end">{(tv.ht / 100).toFixed(2)} DZD</td></tr>
                <tr className="border-b border-black"><td>TVA 0% — base</td><td className="text-end">{(tv.b0 / 100).toFixed(2)} DZD</td></tr>
                <tr className="border-b border-black"><td>TVA 9% — base / montant</td><td className="text-end">{(tv.b9 / 100).toFixed(2)} / {(tv.a9 / 100).toFixed(2)} DZD</td></tr>
                <tr className="border-b border-black"><td>TVA 19% — base / montant</td><td className="text-end">{(tv.b19 / 100).toFixed(2)} / {(tv.a19 / 100).toFixed(2)} DZD</td></tr>
                <tr className="border-b border-black"><td>Total TVA</td><td className="text-end">{(tv.tva / 100).toFixed(2)} DZD</td></tr>
                <tr className="border-b border-black"><td>Timbre fiscal (Art. 136)</td><td className="text-end">{(tv.timbre / 100).toFixed(2)} DZD</td></tr>
                <tr className="font-bold"><td>TOTAL TTC</td><td className="text-end">{(tv.ttc / 100).toFixed(2)} DZD</td></tr>
              </tbody>
            </table>
            <table className="w-full my-3 text-[11px]">
              <tbody>
                <tr className="border-b border-black"><td>Espèces (timbre inclus)</td><td className="text-end">{(tv.esp / 100).toFixed(2)} DZD</td></tr>
                <tr className="border-b border-black"><td>CIB / Dahabiya</td><td className="text-end">{(tv.bank / 100).toFixed(2)} DZD</td></tr>
                <tr className="border-b border-black"><td>Crédit accordé</td><td className="text-end">{(tv.cred / 100).toFixed(2)} DZD</td></tr>
                <tr className="border-b border-black"><td>Crédit recouvré</td><td className="text-end">{(tv.coll / 100).toFixed(2)} DZD</td></tr>
              </tbody>
            </table>
          <div className="text-[10px] break-all border-t border-black pt-2">
            <div>prev_hash: {prevHash}</div>
            <div className="font-bold">hash: {chainHash}</div>
            {closeNote && <div>{closeNote}</div>}
          </div>
          <div className="grid grid-cols-2 gap-8 mt-8 text-[11px]">
            <div className="border-t border-black pt-1 text-center">Signature caissier</div>
            <div className="border-t border-black pt-1 text-center">Signature gérant + cachet</div>
          </div>
        </div>
        ) : (
        <div
          id="printable-receipt"
          dir="ltr"
          className="w-full max-w-[300px] bg-white text-black p-4 font-mono text-[11px] leading-tight shadow-2xl border border-slate-300 select-text text-start"
          style={{ fontFamily: "'Courier New', Courier, monospace" }}
        >
          <div className="text-center space-y-0.5 border-b border-black pb-2">
            <div className="font-bold text-sm tracking-wider uppercase">{storeProfile.store_name}</div>
            <div className="font-semibold text-xs">{storeProfile.company_owner}</div>
            <div className="text-[10px]">{storeProfile.address}</div>
            <div className="text-[9.5px]">RC: {storeProfile.rc_number} | NIF: {storeProfile.nif_number}</div>
            <div className="text-[9.5px]">NIS: {storeProfile.nis_number} | AI: {storeProfile.ai_number}</div>
          </div>

          <div className="py-2 border-b border-black text-center">
            <div className="font-bold text-sm uppercase">*** RAPPORT Z DE CAISSE ***</div>
            <div className="text-[10px]">CLÔTURE JOURNALIÈRE FISCALE</div>
            {!closure && (
              <div className="text-[10px] font-bold">— PROVISOIRE / غير نهائي —</div>
            )}
            <div className="text-[10px] pt-1">
              {tvReportNo}{closure && ' — FINALISÉ'}
            </div>
            <div className="text-[10px]">
              Date: {zReport.date} - Heure: {tvClosedAt}
            </div>
            <div className="text-[9px] break-words">
              {tv.first} → {tv.last}
            </div>
            {closeNote && <div className="text-[9px] font-bold">{closeNote}</div>}
          </div>

          <div className="py-2 border-b border-black space-y-1 text-[10px]">
            <div className="flex justify-between">
              <span>Nombre de Ventes:</span>
              <span className="font-bold">{tv.salesCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Total HT:</span>
              <span>{(tv.ht / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>TVA 9% (Base {(tv.b9 / 100).toFixed(2)}):</span>
              <span>{(tv.a9 / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>TVA 19% (Base {(tv.b19 / 100).toFixed(2)}):</span>
              <span>{(tv.a19 / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Timbre Fiscal (Espèces):</span>
              <span>{(tv.timbre / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-black text-xs pt-1 border-t border-black">
              <span>TOTAL TTC:</span>
              <span>{(tv.ttc / 100).toFixed(2)} DZD</span>
            </div>
          </div>

          <div className="py-2 border-b border-black space-y-1 text-[10px]">
            <div className="font-bold uppercase pb-0.5">Ventilation des Paiements:</div>
            <div className="flex justify-between">
              <span>Espèces:</span>
              <span>{(tv.esp / 100).toFixed(2)} DZD</span>
            </div>
            <div className="flex justify-between">
              <span>CIB / Dahabiya:</span>
              <span>{(tv.bank / 100).toFixed(2)} DZD</span>
            </div>
            <div className="flex justify-between">
              <span>Crédit Client (Carnet):</span>
              <span>{(tv.cred / 100).toFixed(2)} DZD</span>
            </div>
            <div className="flex justify-between">
              <span>Règlements Crédits Reçus:</span>
              <span>{(tv.coll / 100).toFixed(2)} DZD</span>
            </div>
          </div>

          <div className="py-2 border-b border-black space-y-1 text-[10px]">
            <div className="font-bold uppercase pb-0.5">Chaîne Fiscale (SHA-256):</div>
            <div className="break-all">prev: {shortHash(prevHash)}</div>
            <div className="break-all font-bold">hash: {shortHash(chainHash)}</div>
          </div>

          <div className="text-center pt-2 space-y-0.5 text-[9px] text-slate-700">
            <div>Signé par le Caissier & Gérant</div>
            <div className="font-semibold text-slate-500 pt-1">Baraka Market v{APP_VERSION} by BarakaDEV</div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
