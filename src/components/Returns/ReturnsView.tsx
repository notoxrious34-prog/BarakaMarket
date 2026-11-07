import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import { formatDZDFromCt } from '../../core/display';
import { RETURN_REASONS, RETURN_TWO_PERSON_THRESHOLD_CT } from '../../types/index';
import type { ReturnReasonCode, ReturnStatus } from '../../types/index';
import {
  lookupReturnSale, createReturnDraft, approveReturn, rejectReturn, getReturn,
  listReturns, lastReturnLaneError,
} from '../../core/returns-authority';
import type { ReturnHead, ReturnSaleLookup } from '../../core/returns-authority';
import { ReturnThermalTicket } from '../Receipts/ReturnThermalTicket';
import { RotateCcw, Search, CheckCircle2, XCircle, Printer, RefreshCw } from 'lucide-react';

const REASON_LABEL: Record<ReturnReasonCode, { ar: string; fr: string }> = {
  DEFECT: { ar: 'عيب مصنعي', fr: 'Défaut' },
  WRONG_ITEM: { ar: 'صنف خاطئ', fr: 'Mauvais article' },
  SIZE_FIT: { ar: 'مقاس / حجم', fr: 'Taille' },
  EXPIRED: { ar: 'منتهي الصلاحية', fr: 'Expiré' },
  CHANGED_MIND: { ar: 'عدول الزبون', fr: 'Avis changé' },
  OTHER: { ar: 'أخرى', fr: 'Autre' },
};

const STATUS_LABEL: Record<ReturnStatus, { ar: string; fr: string }> = {
  DRAFT: { ar: 'مسودة', fr: 'Brouillon' },
  APPROVED: { ar: 'مقبول', fr: 'Approuvé' },
  REJECTED: { ar: 'مرفوض', fr: 'Rejeté' },
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
  const { session, language } = useApp();
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

  const doLookup = async () => {
    setLooking(true); setLookupMsg(null); setLookup(null); setPicked({});
    const f = await lookupReturnSale(lookupKey);
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

  const doApprove = async (r: ReturnHead) => {
    setBusy(true);
    const out = await approveReturn(r.id, session.username, session.role);
    setBusy(false);
    if (!out) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setMsg({ kind: 'ok', text: isAr ? `تم القبول ${out.return_number} — اطبع الوصل` : `Approuvé ${out.return_number} — imprimez le bon` });
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
      <div className="flex items-center gap-3">
        <RotateCcw className="w-6 h-6 text-amber-400" />
        <div>
          <h2 className="text-xl font-black">{isAr ? 'إرجاع سلعة' : 'Retour marchandise'}</h2>
          <p className="text-xs text-slate-400">{isAr ? 'بحث بالفاتورة ← مسودة ← قرار المدير ← وصل' : 'FACT → brouillon → décision → bon'}</p>
        </div>
      </div>

      {msg && (
        <div className={`px-4 py-2.5 rounded-xl text-sm font-bold border ${msg.kind === 'ok' ? 'bg-emerald-950 border-emerald-800 text-emerald-200' : 'bg-red-950 border-red-800 text-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Lookup */}
      <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={lookupKey}
            onChange={e => setLookupKey(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void doLookup(); }}
            placeholder={isAr ? 'رقم الفاتورة FACT-… أو المعرف' : 'N° FACT-… ou identifiant'}
            className="flex-1 bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
            dir="ltr"
          />
          <button type="button" onClick={() => void doLookup()} disabled={looking || !lookupKey.trim()}
            className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 font-bold text-sm flex items-center gap-2 justify-center">
            <Search className="w-4 h-4" />{isAr ? 'بحث' : 'Chercher'}
          </button>
        </div>
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

      {/* List */}
      <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3">
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-mono font-bold text-amber-300">{r.return_number ?? r.id.slice(0, 8)}</span>
                <span className="font-mono text-slate-400 text-xs">← {r.invoice_number}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.status === 'APPROVED' ? 'bg-emerald-900 text-emerald-200' : r.status === 'REJECTED' ? 'bg-red-900 text-red-200' : 'bg-yellow-900 text-yellow-200'}`}>
                  {isAr ? STATUS_LABEL[r.status].ar : STATUS_LABEL[r.status].fr}
                </span>
                <span className="text-xs text-slate-400">{isAr ? REASON_LABEL[r.reason].ar : REASON_LABEL[r.reason].fr}</span>
                <span className="font-bold text-emerald-300">{formatDZDFromCt(r.refund_ct)}</span>
                <span className="text-xs text-slate-500">{r.sale_day}{r.posting_day && r.posting_day !== r.sale_day ? ` → ${r.posting_day}` : ''}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {r.status === 'DRAFT' && canDecide && (
                  <>
                    <button type="button" onClick={() => void doApprove(r)} disabled={busy}
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
            </div>
          ))}
        </div>
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
