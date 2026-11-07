import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import { formatDZDFromCt } from '../../core/display';
import { RETURN_REASONS, RETURN_TWO_PERSON_THRESHOLD_CT, RETURN_DISPOSITIONS, DEFAULT_DISPOSITION, CLAIM_REASONS } from '../../types/index';
import type { ReturnReasonCode, ReturnStatus, ReturnDisposition, ClaimReasonCode, ClaimResolution } from '../../types/index';
import {
  lookupReturnSale, createReturnDraft, approveReturn, rejectReturn, getReturn,
  listReturns, lastReturnLaneError,
} from '../../core/returns-authority';
import type { ReturnHead, ReturnSaleLookup } from '../../core/returns-authority';
import {
  createSupplierClaim, settleSupplierClaim, listSupplierClaims, listQuarantineRows,
  lastClaimLaneError,
} from '../../core/claims-authority';
import type { ClaimHead, QuarantineRow } from '../../core/claims-authority';
import { ReturnThermalTicket } from '../Receipts/ReturnThermalTicket';
import { RotateCcw, Search, CheckCircle2, XCircle, Printer, RefreshCw, Receipt, ClipboardList, PackageSearch } from 'lucide-react';

const REASON_LABEL: Record<ReturnReasonCode, { ar: string; fr: string }> = {
  DEFECT: { ar: 'عيب مصنعي', fr: 'Défaut' },
  WRONG_ITEM: { ar: 'صنف خاطئ', fr: 'Mauvais article' },
  SIZE_FIT: { ar: 'مقاس / حجم', fr: 'Taille' },
  EXPIRED: { ar: 'منتهي الصلاحية', fr: 'Expiré' },
  CHANGED_MIND: { ar: 'عدول الزبون', fr: 'Avis changé' },
  OTHER: { ar: 'أخرى', fr: 'Autre' },
};

const DISP_LABEL: Record<ReturnDisposition, { ar: string; fr: string }> = {
  RESTOCK: { ar: 'إعادة للرف', fr: 'Remise en rayon' },
  QUARANTINE: { ar: 'حجر (للمندوب)', fr: 'Quarantaine (représentant)' },
  DESTROY: { ar: 'إتلاف', fr: 'Destruction' },
};

const STATUS_LABEL: Record<ReturnStatus, { ar: string; fr: string }> = {
  DRAFT: { ar: 'مسودة', fr: 'Brouillon' },
  APPROVED: { ar: 'مقبول', fr: 'Approuvé' },
  REJECTED: { ar: 'مرفوض', fr: 'Rejeté' },
};

const CLAIM_REASON_LABEL: Record<ClaimReasonCode, { ar: string; fr: string }> = {
  DEFECT: { ar: 'عيب مصنعي', fr: 'Défaut' },
  EXPIRED: { ar: 'منتهي الصلاحية', fr: 'Expiré' },
  WRONG_DELIVERY: { ar: 'تسليم خاطئ', fr: 'Mauvaise livraison' },
  SHORTAGE: { ar: 'نقص في الكمية', fr: 'Manquant' },
  OTHER: { ar: 'أخرى', fr: 'Autre' },
};

const CLAIM_RES_LABEL: Record<ClaimResolution, { ar: string; fr: string }> = {
  CREDIT_NOTE: { ar: 'إشعار دائن (avoir)', fr: 'Avoir' },
  REPLACED: { ar: 'استبدال', fr: 'Échange' },
  REFUNDED: { ar: 'استرجاع نقدي', fr: 'Remboursé' },
  REJECTED: { ar: 'رفض المورّد', fr: 'Refus fournisseur' },
};

/** Lane refusal → cashier-facing message (the lane decides, the view translates). */
function mapReturnError(raw: string | null, isAr: boolean): string {
  const r = (raw ?? '').toLowerCase();
  const pick = (ar: string, fr: string) => (isAr ? ar : fr);
  if (!r) return pick('رفض غير معلن — راجع السجل', 'Refus non précisé — voir audit');
  if (r.includes('not found')) return pick('غير موجود — تحقق من الرقم', 'Introuvable — vérifiez le numéro');
  if (r.includes('window')) return pick('انتهت مهلة 7 أيام', 'Délai de 7 jours dépassé');
  if (r.includes('second person') || r.includes('self-approv')) return pick('مبلغ ≥ 5000 دج: يلزم مُعتمِد ثانٍ (غير منشئ المسودة)', '≥ 5000 DA : second approbateur requis');
  if (r.includes('open cash session')) return pick('افتح جلسة صندوق أولاً', 'Ouvrez une session de caisse');
  if (r.includes('manager or owner')) return pick('القرار للمدير/المالك فقط', 'Décision manager/propriétaire uniquement');
  if (r.includes('already decided')) return pick('حُسم هذا الإرجاع مسبقاً', 'Retour déjà traité');
  if (r.includes('exceeds remaining') || r.includes('remaining')) return pick('الكمية تتجاوز المتبقي القابل للإرجاع', 'Quantité supérieure au reliquat');
  if (r.includes('locked') || r.includes('clôtur')) return pick('اليوم الجبائي مغلق', 'Journée fiscale clôturée');
  if (r.includes('needs a note')) return pick('سبب «أخرى» يتطلب ملاحظة تشرح العيب', 'Motif «Autre» : note explicative requise');
  if (r.includes('drawer short')) {
    const nums = (raw ?? '').match(/\d+/g)?.map(Number) ?? [];
    const fmt = (n: number) => formatDZDFromCt(n);
    const detail = nums.length >= 2 ? ` (${isAr ? 'الدرج' : 'Tiroir'}: ${fmt(nums[0])} · ${isAr ? 'المطلوب' : 'Requis'}: ${fmt(nums[1])})` : '';
    return pick(`الدرج لا يكفي لهذا الاسترداد${detail}`, `Fond insuffisant pour ce remboursement${detail}`);
  }
  if (r.includes('not completed') || r.includes('cancelled')) return pick('الفاتورة ملغاة/غير مكتملة — ليست للإرجاع', 'Facture annulée — hors retour');
  if (r.includes('unreachable')) return pick('القاعدة لا تستجيب', 'Base injoignable');
  return pick(`رفض: ${raw}`, `Refus : ${raw}`);
}

const fmtUnitQty = (milli: number, unit: string): string =>
  unit === 'PIECE' ? String(milli / 1000) : unit === 'KG' ? `${milli} غ` : `${milli} مل`;

const toMilli = (v: number, unit: string): number =>
  unit === 'PIECE' ? Math.round(v) * 1000 : Math.round(v);

/**
 * v1.5.0 — Returns desk. Lookup by FACT → draft (cashier+) → approve/reject
 * (manager+) → BON DE RETOUR. All guards live lane-side; the view only gates
 * buttons by role and translates refusals.
 */
export const ReturnsView: React.FC = () => {
  const { session, language, suppliers } = useApp();
  const isAr = language === 'ar';

  const [lookupKey, setLookupKey] = useState('');
  const [lookup, setLookup] = useState<ReturnSaleLookup | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [reason, setReason] = useState<ReturnReasonCode>('DEFECT');
  const [reasonNote, setReasonNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [filter, setFilter] = useState<'' | ReturnStatus>('');
  const [rows, setRows] = useState<ReturnHead[]>([]);
  const [listing, setListing] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [ticket, setTicket] = useState<(ReturnHead & { items: Record<string, unknown>[] }) | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [approveItems, setApproveItems] = useState<{ id: number; name_fr: string; qty_milli: number; unit: string }[]>([]);
  const [disp, setDisp] = useState<Record<number, ReturnDisposition>>({});

  // R-bridge: quarantine held for the rep + the claims filed over it.
  const [quar, setQuar] = useState<QuarantineRow[]>([]);
  const [claims, setClaims] = useState<ClaimHead[]>([]);
  const [claimFilter, setClaimFilter] = useState<'' | 'OPEN' | 'SETTLED'>('');
  const [claimFor, setClaimFor] = useState<number | null>(null);
  const [claimSupplier, setClaimSupplier] = useState('');
  const [claimReason, setClaimReason] = useState<ClaimReasonCode>('DEFECT');
  const [claimNote, setClaimNote] = useState('');
  const [settleId, setSettleId] = useState<string | null>(null);
  const [settleRes, setSettleRes] = useState<ClaimResolution>('CREDIT_NOTE');
  const refreshClaims = useCallback(async () => {
    const [q, c] = await Promise.all([
      listQuarantineRows(),
      listSupplierClaims(claimFilter || undefined),
    ]);
    if (q) setQuar(q);
    if (c) setClaims(c);
    else if (c === null) setMsg({ kind: 'err', text: mapReturnError(lastClaimLaneError(), isAr) });
  }, [claimFilter, isAr]);

  useEffect(() => { void refreshClaims(); }, [refreshClaims]);

  const refresh = useCallback(async () => {
    setListing(true);
    const list = await listReturns(filter || undefined);
    setListing(false);
    if (!list) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setRows(list);
  }, [filter, isAr]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!session) {
    return (
      <div className="p-6 text-center text-slate-400">
        {isAr ? 'سجّل الدخول أولاً.' : 'Connectez-vous d’abord.'}
      </div>
    );
  }
  const canCreate = can(session.role, 'returns.create');
  const canDecide = can(session.role, 'returns.approve');
  const canClaim = can(session.role, 'claims.create');
  const canSettleClaim = can(session.role, 'claims.settle');

  const doClaim = async (row: QuarantineRow) => {
    const sid = Number(claimSupplier);
    if (!Number.isInteger(sid) || sid <= 0) {
      setMsg({ kind: 'err', text: isAr ? 'اختر المورّد من القائمة' : 'Choisissez le fournisseur' });
      return;
    }
    const sup = suppliers.find(s => s.id === sid);
    setBusy(true);
    const out = await createSupplierClaim({
      supplier_id: sid, supplier_name: sup?.name ?? `#${sid}`,
      product_id: row.product_id, qty_milli: row.qty_milli,
      reason: claimReason, note: claimNote.trim() || undefined, actor: session.username,
    });
    setBusy(false);
    if (!out) { setMsg({ kind: 'err', text: mapReturnError(lastClaimLaneError(), isAr) }); return; }
    setClaimFor(null); setClaimSupplier(''); setClaimNote('');
    setMsg({ kind: 'ok', text: isAr ? `مطالبة ${out.claim_number} مسجلة` : `Réclamation ${out.claim_number} créée` });
    void refreshClaims();
  };

  const doSettleClaim = async (id: string) => {
    setBusy(true);
    const ok = await settleSupplierClaim(id, settleRes, session.username, session.role);
    setBusy(false);
    if (!ok) { setMsg({ kind: 'err', text: mapReturnError(lastClaimLaneError(), isAr) }); return; }
    setSettleId(null);
    setMsg({ kind: 'ok', text: isAr ? 'سُوّيت المطالبة' : 'Réclamation soldée' });
    void refreshClaims();
  };

  const doLookup = async () => {
    setLooking(true); setLookupMsg(null); setLookup(null); setPicked({});
    // Supermarket lane: forgive case, spaces and short digits before hitting
    // the DAL (which completes FACT-{year}-{pad6} and unique suffixes itself).
    const f = await lookupReturnSale(lookupKey.trim().toUpperCase().replace(/\s+/g, ''));
    setLooking(false);
    if (!f) { setLookupMsg(mapReturnError(lastReturnLaneError(), isAr)); return; }
    setLookup(f);
    // Preselect every returnable line at full remaining — untick to shrink.
    const pre: Record<number, number> = {};
    for (const it of f.items) {
      if (it.remaining_milli > 0) pre[it.sale_item_id] = it.unit === 'PIECE' ? it.remaining_milli / 1000 : it.remaining_milli;
    }
    setPicked(pre);
  };

  const doCreate = async () => {
    if (!lookup) return;
    // A4 (supermarket): OTHER without a note is refused lane-side too.
    if (reason === 'OTHER' && !reasonNote.trim()) {
      setMsg({ kind: 'err', text: mapReturnError('needs a note', isAr) });
      return;
    }
    const lines = Object.entries(picked)
      .map(([sid, v]) => ({ saleItemId: Number(sid), v }))
      .filter(e => Number.isFinite(e.v) && e.v > 0)
      .map(e => {
        const line = lookup.items.find(i => i.sale_item_id === e.saleItemId)!;
        return { saleItemId: e.saleItemId, qty_milli: toMilli(e.v, line.unit) };
      })
      .filter(l => l.qty_milli > 0);
    if (!lines.length) { setMsg({ kind: 'err', text: isAr ? 'اختر سطراً وكمية' : 'Choisissez ligne + quantité' }); return; }
    setBusy(true);
    const d = await createReturnDraft({
      sale_id: lookup.sale.id, lines, reason,
      reason_note: reasonNote.trim() || null, actor: session.username,
    });
    setBusy(false);
    if (!d) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setMsg({ kind: 'ok', text: isAr ? `مسودة محفوظة — مسترد ${formatDZDFromCt(d.refund_ct)} بانتظار المدير` : `Brouillon — ${formatDZDFromCt(d.refund_ct)} en attente manager` });
    setLookup(null); setLookupKey(''); setPicked({}); setReasonNote('');
    void refresh();
  };

  const openApprove = async (r: ReturnHead) => {
    const full = await getReturn(r.id);
    if (!full) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    const items = (full.items as unknown[]).map(it => {
      const o = it as { id?: number; name_fr?: string; qty_milli?: number; unit?: string };
      return { id: Number(o.id ?? 0), name_fr: String(o.name_fr ?? ''), qty_milli: Number(o.qty_milli ?? 0), unit: String(o.unit ?? 'PIECE') };
    }).filter(it => it.id > 0);
    const pre: Record<number, ReturnDisposition> = {};
    for (const it of items) pre[it.id] = DEFAULT_DISPOSITION[r.reason];
    setApproveItems(items);
    setDisp(pre);
    setApproveId(r.id);
  };

  const confirmApprove = async (r: ReturnHead) => {
    // Every line must carry a valid disposition before the money moves.
    if (approveItems.some(it => !disp[it.id])) {
      setMsg({ kind: 'err', text: isAr ? 'حدد مصير كل سطر' : 'Choisissez le sort de chaque ligne' });
      return;
    }
    setBusy(true);
    const out = await approveReturn(r.id, session.username, session.role, disp);
    setBusy(false);
    if (!out) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setMsg({ kind: 'ok', text: isAr ? `تم القبول ${out.return_number} — اطبع الوصل` : `Approuvé ${out.return_number} — imprimez le bon` });
    setApproveId(null);
    void refresh();
  };

  const doReject = async (id: string) => {
    setBusy(true);
    const ok = await rejectReturn(id, session.username, rejectNote.trim() || undefined);
    setBusy(false);
    setRejectId(null); setRejectNote('');
    if (!ok) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setMsg({ kind: 'ok', text: isAr ? 'رُفضت المسودة نهائياً' : 'Brouillon rejeté (définitif)' });
    void refresh();
  };

  const openTicket = async (id: string) => {
    const full = await getReturn(id);
    if (!full) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setTicket(full);
  };

  if (!session) {
    return (
      <div className="p-6 text-center text-slate-400">
        {isAr ? 'سجّل الدخول أولاً.' : 'Connectez-vous d’abord.'}
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="p-6 text-center text-slate-400">
        {isAr ? 'الإرجاع للصرّافين فما فوق.' : 'Retours réservés aux caissiers et +.'}
      </div>
    );
  }

  const selfApproveBlocked = (r: ReturnHead) =>
    canDecide && r.actor === session.username && r.refund_ct >= RETURN_TWO_PERSON_THRESHOLD_CT;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto text-slate-100">
      {/* Institutional hero — the 4-gate pipeline at a glance. */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[#111722] via-[#162030] to-[#111722] border border-[#1e293b] rounded-2xl p-5 md:p-6 shadow-2xl">
        <div aria-hidden={true} className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent" />
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
            <RotateCcw className="w-6 h-6 text-amber-400" />
          </span>
          <div>
            <h2 className="text-xl font-black text-white">{isAr ? 'مكتب الإرجاع' : 'Bureau des retours'}</h2>
            <p className="text-xs text-slate-400">{isAr ? 'بحث ذكي بالفاتورة ← مسودة ← قرار المدير ← وصل وحجر' : 'Recherche FACT intelligente → brouillon → décision → bon & quarantaine'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {[
            { n: '01', t: isAr ? 'بحث الفاتورة' : 'Recherche FACT' },
            { n: '02', t: isAr ? 'المسودات والقرارات' : 'Brouillons & décisions' },
            { n: '03', t: isAr ? 'الحجر والمطالبات' : 'Quarantaine & litiges' },
            { n: '04', t: isAr ? 'الوصل الحراري' : 'Bon thermique' },
          ].map(s => (
            <span key={s.n} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#0b0f17] border border-[#2b3a4f] text-slate-300">
              <span className="font-mono text-amber-400">{s.n}</span> {s.t}
            </span>
          ))}
        </div>
      </div>

      {msg && (
        <div className={`px-4 py-2.5 rounded-xl text-sm font-bold border ${msg.kind === 'ok' ? 'bg-emerald-950 border-emerald-800 text-emerald-200' : 'bg-red-950 border-red-800 text-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* 01 · Smart lookup — full FACT, short digits, suffix, scan. */}
      <section className="bg-[#111722] border border-amber-500/20 rounded-2xl p-4 space-y-3 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25">01</span>
          <Receipt className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-black text-white">{isAr ? 'البحث عن الفاتورة' : 'Recherche de facture'}</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={lookupKey}
            autoFocus
            onChange={e => setLookupKey(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void doLookup(); }}
            placeholder={isAr ? 'FACT-2026-000042 … أو 42 … أو امسح/الصق' : 'FACT-2026-000042 … ou 42 … ou scannez'}
            className="flex-1 bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
            dir="ltr"
          />
          <button type="button" onClick={() => void doLookup()} disabled={looking || !lookupKey.trim()}
            className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 font-bold text-sm flex items-center gap-2 justify-center">
            <Search className="w-4 h-4" />{looking ? '…' : isAr ? 'بحث' : 'Chercher'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">{isAr ? 'يقبل: الرقم الكامل، الأرقام الأخيرة فقط، ولو بأحرف صغيرة — والماسح يرسل تلقائياً بزر Enter.' : 'Accepte : numéro complet, derniers chiffres, minuscules — le scanneur valide via Entrée.'}</p>
        {lookupMsg && <div className="text-sm text-red-300 font-bold">{lookupMsg}</div>}

        {lookup && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-mono font-bold text-amber-300">{lookup.sale.invoice_number}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${lookup.sale.status === 'COMPLETED' ? 'bg-emerald-900 text-emerald-200' : 'bg-red-900 text-red-200'}`}>{lookup.sale.status}</span>
              <span className="text-slate-400">{lookup.sale.payment_method}</span>
              <span className="text-slate-400 font-mono">{lookup.sale.total_ttc_ct / 100} دج</span>
            </div>
            <div className="space-y-2">
              {lookup.items.map(it => (
                <div key={it.sale_item_id} className="flex items-center gap-3 bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2">
                  <input type="checkbox" className="w-4 h-4 accent-amber-500"
                    checked={it.sale_item_id in picked}
                    disabled={it.remaining_milli <= 0}
                    onChange={e => setPicked(p => {
                      const n = { ...p };
                      if (e.target.checked) n[it.sale_item_id] = it.unit === 'PIECE' ? it.remaining_milli / 1000 : it.remaining_milli;
                      else delete n[it.sale_item_id];
                      return n;
                    })}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{it.name_fr}</div>
                    <div className="text-xs text-slate-400">
                      {isAr ? 'المباع' : 'Vendu'} {fmtUnitQty(it.qty_milli, it.unit)}
                      {' · '}{isAr ? 'المتبقي' : 'Reliquat'} <span className="text-emerald-300 font-bold">{fmtUnitQty(it.remaining_milli, it.unit)}</span>
                    </div>
                  </div>
                  <input type="number" min={0} step={it.unit === 'PIECE' ? 1 : 1} dir="ltr"
                    value={picked[it.sale_item_id] ?? ''}
                    disabled={!(it.sale_item_id in picked)}
                    onChange={e => setPicked(p => ({ ...p, [it.sale_item_id]: Number(e.target.value) }))}
                    className="w-24 bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-sm font-mono text-center disabled:opacity-30"
                  />
                  <span className="text-xs text-slate-500 w-8">{it.unit === 'PIECE' ? (isAr ? 'قطع' : 'pcs') : it.unit === 'KG' ? 'غ' : 'مل'}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={reason} onChange={e => setReason(e.target.value as ReturnReasonCode)}
                className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2.5 text-sm">
                {RETURN_REASONS.map(r => <option key={r} value={r}>{isAr ? REASON_LABEL[r].ar : REASON_LABEL[r].fr}</option>)}
              </select>
              <input value={reasonNote} onChange={e => setReasonNote(e.target.value.slice(0, 140))}
                placeholder={isAr ? 'ملاحظة (اختيارية، 140)' : 'Note (optionnel, 140)'}
                className="flex-1 bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2.5 text-sm placeholder:text-slate-600" />
              <button type="button" onClick={() => void doCreate()} disabled={busy}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 font-bold text-sm">
                {isAr ? 'حفظ مسودة' : 'Brouillon'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 02 · Drafts & decisions — filter, decide, print. */}
      <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25">02</span>
          <ClipboardList className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-black text-white">{isAr ? 'المسودات والقرارات' : 'Brouillons & décisions'}</h3>
          {rows.length > 0 && (
            <span className="ms-auto text-[11px] font-bold text-slate-400 font-mono" dir="ltr">{rows.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => void refresh()} className="p-2 rounded-lg border border-[#2b3a4f] text-slate-300 hover:text-white" title={isAr ? 'تحديث' : 'Actualiser'}>
            <RefreshCw className={`w-4 h-4 ${listing ? 'animate-spin' : ''}`} />
          </button>
          {(['', 'DRAFT', 'APPROVED', 'REJECTED'] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${filter === f ? 'bg-amber-600 text-white' : 'bg-[#0b0f17] text-slate-400 border border-[#2b3a4f]'}`}>
              {f === '' ? (isAr ? 'الكل' : 'Tous') : isAr ? STATUS_LABEL[f].ar : STATUS_LABEL[f].fr}
            </button>
          ))}
        </div>
        {rows.length === 0 && <div className="text-sm text-slate-500">{isAr ? 'لا إرجاعات.' : 'Aucun retour.'}</div>}
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="font-mono font-bold text-amber-300">{r.return_number ?? r.id.slice(0, 8)}</span>
                <span className="font-mono text-slate-400 text-xs">← {r.invoice_number}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.status === 'APPROVED' ? 'bg-emerald-900 text-emerald-200' : r.status === 'REJECTED' ? 'bg-red-900 text-red-200' : 'bg-yellow-900 text-yellow-200'}`}>
                  {isAr ? STATUS_LABEL[r.status].ar : STATUS_LABEL[r.status].fr}
                </span>
                <span className="text-xs text-slate-400">{isAr ? REASON_LABEL[r.reason].ar : REASON_LABEL[r.reason].fr}</span>
                <span className="font-bold text-emerald-300">{formatDZDFromCt(r.refund_ct)}</span>
                <span className="text-xs text-slate-500">{r.sale_day}{r.posting_day && r.posting_day !== r.sale_day ? ` → ${r.posting_day}` : ''}</span>
                <span className="ms-auto flex flex-wrap items-center gap-2">
                {r.status === 'DRAFT' && canDecide && (
                  <>
                    <button type="button" onClick={() => void openApprove(r)} disabled={busy}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />{isAr ? 'قبول' : 'Approuver'}
                    </button>
                    <button type="button" onClick={() => { setRejectId(rejectId === r.id ? null : r.id); setRejectNote(''); }}
                      className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-xs font-bold flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" />{isAr ? 'رفض' : 'Rejeter'}
                    </button>
                  </>
                )}
                {r.status === 'APPROVED' && (
                  <button type="button" onClick={() => void openTicket(r.id)}
                    className="px-3 py-1.5 rounded-lg bg-[#162030] border border-[#2b3a4f] text-xs font-bold flex items-center gap-1 hover:border-amber-500">
                    <Printer className="w-3.5 h-3.5" />{isAr ? 'الوصل' : 'Bon'}
                  </button>
                )}
                {selfApproveBlocked(r) && r.status === 'DRAFT' && (
                  <span className="text-xs text-amber-300 font-bold">{isAr ? '≥ 5000 دج وأنت المنشئ: يلزم مُعتمِد ثانٍ' : '≥ 5000 DA et vous êtes l’auteur : second approbateur requis'}</span>
                )}
                </span>
              </div>
              {rejectId === r.id && (
                <div className="flex gap-2 mt-2">
                  <input value={rejectNote} onChange={e => setRejectNote(e.target.value.slice(0, 140))}
                    placeholder={isAr ? 'سبب الرفض (اختياري)' : 'Motif du rejet (optionnel)'}
                    className="flex-1 bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-xs" />
                  <button type="button" onClick={() => void doReject(r.id)} disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-40 text-xs font-bold">
                    {isAr ? 'تأكيد الرفض' : 'Confirmer'}
                  </button>
                </div>
              )}
              {approveId === r.id && (
                <div className="mt-2 space-y-2 border-t border-[#1e293b] pt-2">
                  <div className="text-xs font-bold text-amber-300">{isAr ? 'مصير كل سطر قبل تحريك المال:' : 'Sort de chaque ligne avant de rembourser :'}</div>
                  {approveItems.map(it => (
                    <div key={it.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 min-w-0 truncate text-slate-300">{it.name_fr}</span>
                      <select
                        value={disp[it.id] ?? DEFAULT_DISPOSITION[r.reason]}
                        onChange={e => setDisp(p => ({ ...p, [it.id]: e.target.value as ReturnDisposition }))}
                        className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg px-2 py-1 text-xs">
                        {RETURN_DISPOSITIONS.map(d => <option key={d} value={d}>{isAr ? DISP_LABEL[d].ar : DISP_LABEL[d].fr}</option>)}
                      </select>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void confirmApprove(r)} disabled={busy}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold">
                      {isAr ? 'تأكيد القبول' : 'Confirmer l’approbation'}
                    </button>
                    <button type="button" onClick={() => setApproveId(null)} disabled={busy}
                      className="px-3 py-1.5 rounded-lg bg-[#162030] border border-[#2b3a4f] text-xs font-bold">
                      {isAr ? 'إلغاء' : 'Annuler'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 03 · Quarantine held for the rep + supplier claims over it. */}
      <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25">03</span>
          <PackageSearch className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-black text-slate-200">
            {isAr ? 'الحجر الصحي والمطالبات (المورّدون)' : 'Quarantaine & réclamations'}
          </h3>
          <button type="button" onClick={() => void refreshClaims()}
            className="ms-auto p-2 rounded-lg border border-[#2b3a4f] text-slate-300 hover:text-white" title={isAr ? 'تحديث' : 'Actualiser'}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {quar.length === 0 && (
          <p className="text-xs text-slate-500">{isAr ? 'لا سلع محجوزة حالياً.' : 'Rien en quarantaine.'}</p>
        )}
        {quar.map((q, i) => (
          <div key={`${q.return_number}-${i}`} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-black text-slate-100">{q.name_fr}</span>
              <span className="font-mono text-amber-300" dir="ltr">{fmtUnitQty(q.qty_milli, q.unit)} {q.unit}</span>
              <span className="text-slate-500 font-mono" dir="ltr">{q.return_number}</span>
            </div>
            {canClaim && claimFor === i ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select value={claimSupplier} onChange={e => setClaimSupplier(e.target.value)}
                  className="bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-amber-500">
                  <option value="">{isAr ? '— المورّد —' : '— Fournisseur —'}</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} #{s.id}</option>)}
                </select>
                <select value={claimReason} onChange={e => setClaimReason(e.target.value as ClaimReasonCode)}
                  className="bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-amber-500">
                  {CLAIM_REASONS.map(r => <option key={r} value={r}>{isAr ? CLAIM_REASON_LABEL[r].ar : CLAIM_REASON_LABEL[r].fr}</option>)}
                </select>
                <input value={claimNote} onChange={e => setClaimNote(e.target.value)} maxLength={140}
                  placeholder={isAr ? 'ملاحظة (اختيارية)' : 'Note (optionnelle)'}
                  className="sm:col-span-2 bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-2 text-xs placeholder:text-slate-600 focus:outline-none focus:border-amber-500" />
                <div className="sm:col-span-2 flex gap-2">
                  <button type="button" onClick={() => void doClaim(q)} disabled={busy}
                    className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-bold">
                    {isAr ? 'تسجيل المطالبة' : 'Créer la réclamation'}
                  </button>
                  <button type="button" onClick={() => setClaimFor(null)}
                    className="px-3 py-2 rounded-lg border border-[#2b3a4f] text-slate-300 text-xs font-bold">
                    {isAr ? 'إلغاء' : 'Annuler'}
                  </button>
                </div>
              </div>
            ) : (
              canClaim && (
                <button type="button" onClick={() => { setClaimFor(i); setClaimSupplier(''); setClaimNote(''); setClaimReason('DEFECT'); }}
                  className="px-3 py-1.5 rounded-lg border border-amber-700 text-amber-300 hover:bg-amber-950 text-xs font-bold">
                  {isAr ? 'مطالبة المورّد' : 'Réclamer au fournisseur'}
                </button>
              )
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          {(['', 'OPEN', 'SETTLED'] as const).map(f => (
            <button key={f} type="button" onClick={() => setClaimFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${claimFilter === f ? 'bg-amber-600 text-white' : 'bg-[#0b0f17] text-slate-400 border border-[#2b3a4f]'}`}>
              {f === '' ? (isAr ? 'كل المطالبات' : 'Toutes') : f === 'OPEN' ? (isAr ? 'مفتوحة' : 'Ouvertes') : (isAr ? 'مسواة' : 'Soldées')}
            </button>
          ))}
        </div>
        {claims.map(c => (
          <div key={c.id} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl p-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-mono font-black text-amber-300" dir="ltr">{c.claim_number}</span>
              <span className="font-bold text-slate-100">{c.supplier_name}</span>
              <span className="text-slate-400">{c.product_name} · <span className="font-mono" dir="ltr">{fmtUnitQty(c.qty_milli, c.unit)}</span></span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-black ${c.status === 'OPEN' ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'}`}>
                {c.status === 'OPEN' ? (isAr ? 'مفتوحة' : 'Ouverte') : (isAr ? 'مسواة' : 'Soldée')}
              </span>
              {c.status === 'SETTLED' && c.resolution && (
                <span className="text-slate-500 text-[11px]">{isAr ? CLAIM_RES_LABEL[c.resolution as ClaimResolution].ar : CLAIM_RES_LABEL[c.resolution as ClaimResolution].fr}</span>
              )}
              <span className="text-slate-500 font-mono" dir="ltr">{formatDZDFromCt(c.total_cost_ct)}</span>
            </div>
            {c.status === 'OPEN' && canSettleClaim && (settleId === c.id ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <select value={settleRes} onChange={e => setSettleRes(e.target.value as ClaimResolution)}
                  className="bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-amber-500">
                  {(['CREDIT_NOTE', 'REPLACED', 'REFUNDED', 'REJECTED'] as const).map(r => (
                    <option key={r} value={r}>{isAr ? CLAIM_RES_LABEL[r].ar : CLAIM_RES_LABEL[r].fr}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void doSettleClaim(c.id)} disabled={busy}
                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold">
                    {isAr ? 'تأكيد التسوية' : 'Solder'}
                  </button>
                  <button type="button" onClick={() => setSettleId(null)}
                    className="px-3 py-2 rounded-lg border border-[#2b3a4f] text-slate-300 text-xs font-bold">
                    {isAr ? 'إلغاء' : 'Annuler'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => { setSettleId(c.id); setSettleRes('CREDIT_NOTE'); }}
                className="px-3 py-1.5 rounded-lg border border-emerald-700 text-emerald-300 hover:bg-emerald-950 text-xs font-bold">
                {isAr ? 'تسوية' : 'Solder'}
              </button>
            ))}
          </div>
        ))}
      </section>

      {ticket && (
        <ReturnThermalTicket
          ret={{
            return_number: ticket.return_number, invoice_number: ticket.invoice_number,
            posting_day: ticket.posting_day, reason: ticket.reason,
            reason_note: (ticket as unknown as { reason_note?: string | null }).reason_note ?? null,
            actor: ticket.actor, approver: ticket.approver, refund_ct: ticket.refund_ct,
            payment_method: ticket.payment_method,
            items: ticket.items.map(it => {
              const o = it as unknown as { name_fr?: string; qty_milli?: number; unit?: string; line_ttc_ct?: number };
              return { name_fr: String(o.name_fr ?? ''), qty_milli: Number(o.qty_milli ?? 0), unit: String(o.unit ?? 'PIECE'), line_ttc_ct: Number(o.line_ttc_ct ?? 0) };
            }),
          }}
          onClose={() => setTicket(null)}
        />
      )}
    </div>
  );
};
