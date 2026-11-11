import React, { memo } from 'react';
import { CheckCircle2, XCircle, Printer, Scale } from 'lucide-react';
import { RETURN_DISPOSITIONS, DEFAULT_DISPOSITION } from '../../types/index';
import type { ReturnDisposition } from '../../types/index';
import type { ReturnHead } from '../../core/returns-authority';
import { formatDZDFromCt } from '../../core/display';
import { STATUS_LABEL, REASON_LABEL, DISP_LABEL } from './returns-panels-shared';
import type { ApproveLine } from './ReturnDraftsPanel';

/**
 * ReturnDecisionDock.tsx — ADR-045 island (mirrors SalesDetailDock).
 * ONE decision point: the selected draft's lines, per-line fate, approve /
 * reject, ticket entry. Memo on the selection slice only.
 */
export interface ReturnDecisionDockProps {
  isAr: boolean;
  draft: ReturnHead | null;
  items: ApproveLine[];
  linesLoading: boolean;
  disp: Record<number, ReturnDisposition>;
  onDisp: (id: number, d: ReturnDisposition) => void;
  busy: boolean;
  canDecide: boolean;
  selfBlocked: boolean;
  rejectNote: string;
  onRejectNote: (v: string) => void;
  onReject: () => void;
  onConfirmApprove: () => void;
  onClear: () => void;
  onOpenTicket: () => void;
}

export const ReturnDecisionDock: React.FC<ReturnDecisionDockProps> = memo(
  function ReturnDecisionDock(p) {
    const { isAr, draft } = p;
    return (
      <aside className="bg-[#111722] border border-amber-500/20 rounded-2xl p-4 space-y-3 lg:sticky lg:top-4 shadow-xl">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-black text-white">
            {isAr ? 'رصيف القرار' : 'Guichet décision'}
          </h3>
          {draft && (
            <button type="button" onClick={p.onClear}
              className="ms-auto text-[11px] font-bold text-slate-500 hover:text-slate-200">
              {isAr ? 'إخلاء ✕' : 'Libérer ✕'}
            </button>
          )}
        </div>
        {!draft && (
          <div className="text-sm text-slate-500">
            {isAr ? 'اختر مسودة من القائمة لاتخاذ القرار.' : 'Sélectionnez un brouillon dans la liste.'}
          </div>
        )}
        {draft && (
          <>
            <div className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2.5 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-amber-300">{draft.return_number ?? draft.id.slice(0, 8)}</span>
                <span className="font-mono text-slate-400 text-xs">← {draft.invoice_number}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${draft.status === 'APPROVED' ? 'bg-emerald-900 text-emerald-200' : draft.status === 'REJECTED' ? 'bg-red-900 text-red-200' : 'bg-yellow-900 text-yellow-200'}`}>
                  {isAr ? STATUS_LABEL[draft.status].ar : STATUS_LABEL[draft.status].fr}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-400">{isAr ? REASON_LABEL[draft.reason].ar : REASON_LABEL[draft.reason].fr}</span>
                <span className="font-bold text-emerald-300">{formatDZDFromCt(draft.refund_ct)}</span>
                <span className="text-slate-500">{draft.sale_day}</span>
              </div>
            </div>
            {draft.status === 'DRAFT' && !p.canDecide && (
              <div className="text-xs text-slate-500">
                {isAr ? 'صلاحية الاعتماد غير ممنوحة لدورك.' : 'Approbation non autorisée pour votre rôle.'}
              </div>
            )}
            {draft.status === 'DRAFT' && p.canDecide && (
              <div className="space-y-2 border-t border-[#1e293b] pt-2">
                <div className="text-xs font-bold text-amber-300">
                  {isAr ? 'مصير كل سطر قبل تحريك المال:' : 'Sort de chaque ligne avant de rembourser :'}
                </div>
                {p.linesLoading && <div className="text-xs text-slate-500">{isAr ? 'جارٍ تحميل السطور…' : 'Chargement…'}</div>}
                {p.items.map(it => (
                  <div key={it.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate text-slate-300">{it.name_fr}</span>
                    <select
                      value={p.disp[it.id] ?? DEFAULT_DISPOSITION[draft.reason]}
                      onChange={e => p.onDisp(it.id, e.target.value as ReturnDisposition)}
                      className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg px-2 py-1 text-xs">
                      {RETURN_DISPOSITIONS.map(d => <option key={d} value={d}>{isAr ? DISP_LABEL[d].ar : DISP_LABEL[d].fr}</option>)}
                    </select>
                  </div>
                ))}
                {p.selfBlocked && (
                  <div className="text-xs text-amber-300 font-bold">
                    {isAr ? '≥ 5000 دج وأنت المنشئ: يلزم مُعتمِد ثانٍ' : '≥ 5000 DA et vous êtes l’auteur : second approbateur requis'}
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={p.onConfirmApprove} disabled={p.busy}
                    className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />{isAr ? 'تأكيد القبول' : 'Confirmer l’approbation'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <input value={p.rejectNote} onChange={e => p.onRejectNote(e.target.value.slice(0, 140))}
                    placeholder={isAr ? 'سبب الرفض (اختياري)' : 'Motif du rejet (optionnel)'}
                    className="flex-1 min-w-0 bg-[#0b0f17] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-xs placeholder:text-slate-600" />
                  <button type="button" onClick={p.onReject} disabled={p.busy}
                    className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-40 text-xs font-bold flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" />{isAr ? 'رفض' : 'Rejeter'}
                  </button>
                </div>
              </div>
            )}
            {draft.status === 'APPROVED' && (
              <button type="button" onClick={p.onOpenTicket}
                className="w-full px-3 py-2 rounded-lg bg-[#0b0f17] border border-[#2b3a4f] hover:border-amber-500 text-xs font-bold flex items-center justify-center gap-1">
                <Printer className="w-3.5 h-3.5" />{isAr ? 'عرض / طبع الوصل الحراري' : 'Voir / imprimer le bon'}
              </button>
            )}
            {draft.status === 'REJECTED' && (
              <div className="text-xs text-slate-500">{isAr ? 'مرفوضة — محفوظة في السجل.' : 'Rejeté — conservé au journal.'}</div>
            )}
          </>
        )}
      </aside>
    );
  },
);
