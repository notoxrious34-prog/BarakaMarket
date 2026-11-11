import React, { memo } from 'react';
import { CheckCircle2, XCircle, Printer, RefreshCw, ClipboardList } from 'lucide-react';
import { RETURN_DISPOSITIONS, DEFAULT_DISPOSITION } from '../../types/index';
import type { ReturnDisposition, ReturnStatus } from '../../types/index';
import type { ReturnHead } from '../../core/returns-authority';
import { formatDZDFromCt } from '../../core/display';
import { STATUS_LABEL, REASON_LABEL, DISP_LABEL } from './returns-panels-shared';

/**
 * MKT-006 island 02 — drafts, decisions, per-line fate, ticket entry.
 * Memo on the drafts slice only.
 */
export interface ApproveLine {
  id: number; name_fr: string; qty_milli: number; unit: string;
}

export interface ReturnDraftsPanelProps {
  isAr: boolean;
  rows: ReturnHead[];
  listing: boolean;
  filter: '' | ReturnStatus;
  onFilter: (f: '' | ReturnStatus) => void;
  onRefresh: () => void;
  busy: boolean;
  canDecide: boolean;
  isSelfApproveBlocked: (r: ReturnHead) => boolean;
  rejectId: string | null;
  rejectNote: string;
  onRejectNote: (v: string) => void;
  onToggleReject: (r: ReturnHead) => void;
  onReject: (id: string) => void;
  onOpenApprove: (r: ReturnHead) => void;
  onOpenTicket: (id: string) => void;
  approveId: string | null;
  approveItems: ApproveLine[];
  disp: Record<number, ReturnDisposition>;
  onDisp: (id: number, d: ReturnDisposition) => void;
  onConfirmApprove: (r: ReturnHead) => void;
  onCancelApprove: () => void;
}

export const ReturnDraftsPanel: React.FC<ReturnDraftsPanelProps> = memo(function ReturnDraftsPanel(p) {
  const { isAr } = p;
  return (
    <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25">02</span>
        <ClipboardList className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-black text-white">{isAr ? 'المسودات والقرارات' : 'Brouillons & décisions'}</h3>
        {p.rows.length > 0 && (
          <span className="ms-auto text-[11px] font-bold text-slate-400 font-mono" dir="ltr">{p.rows.length}</span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={p.onRefresh} className="p-2 rounded-lg border border-[#2b3a4f] text-slate-300 hover:text-white" title={isAr ? 'تحديث' : 'Actualiser'}>
          <RefreshCw className={`w-4 h-4 ${p.listing ? 'animate-spin' : ''}`} />
        </button>
        {(['', 'DRAFT', 'APPROVED', 'REJECTED'] as const).map(f => (
          <button key={f} type="button" onClick={() => p.onFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${p.filter === f ? 'bg-amber-600 text-white' : 'bg-[#0b0f17] text-slate-400 border border-[#2b3a4f]'}`}>
            {f === '' ? (isAr ? 'الكل' : 'Tous') : isAr ? STATUS_LABEL[f].ar : STATUS_LABEL[f].fr}
          </button>
        ))}
      </div>
      {p.rows.length === 0 && <div className="text-sm text-slate-500">{isAr ? 'لا إرجاعات.' : 'Aucun retour.'}</div>}
      <div className="space-y-2">
        {p.rows.map(r => (
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
              {r.status === 'DRAFT' && p.canDecide && (
                <>
                  <button type="button" onClick={() => p.onOpenApprove(r)} disabled={p.busy}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />{isAr ? 'قبول' : 'Approuver'}
                  </button>
                  <button type="button" onClick={() => p.onToggleReject(r)}
                    className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-xs font-bold flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" />{isAr ? 'رفض' : 'Rejeter'}
                  </button>
                </>
              )}
              {r.status === 'APPROVED' && (
                <button type="button" onClick={() => p.onOpenTicket(r.id)}
                  className="px-3 py-1.5 rounded-lg bg-[#162030] border border-[#2b3a4f] text-xs font-bold flex items-center gap-1 hover:border-amber-500">
                  <Printer className="w-3.5 h-3.5" />{isAr ? 'الوصل' : 'Bon'}
                </button>
              )}
              {p.isSelfApproveBlocked(r) && r.status === 'DRAFT' && (
                <span className="text-xs text-amber-300 font-bold">{isAr ? '≥ 5000 دج وأنت المنشئ: يلزم مُعتمِد ثانٍ' : '≥ 5000 DA et vous êtes l’auteur : second approbateur requis'}</span>
              )}
              </span>
            </div>
            {p.rejectId === r.id && (
              <div className="flex gap-2 mt-2">
                <input value={p.rejectNote} onChange={e => p.onRejectNote(e.target.value.slice(0, 140))}
                  placeholder={isAr ? 'سبب الرفض (اختياري)' : 'Motif du rejet (optionnel)'}
                  className="flex-1 bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-xs" />
                <button type="button" onClick={() => p.onReject(r.id)} disabled={p.busy}
                  className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-40 text-xs font-bold">
                  {isAr ? 'تأكيد الرفض' : 'Confirmer'}
                </button>
              </div>
            )}
            {p.approveId === r.id && (
              <div className="mt-2 space-y-2 border-t border-[#1e293b] pt-2">
                <div className="text-xs font-bold text-amber-300">{isAr ? 'مصير كل سطر قبل تحريك المال:' : 'Sort de chaque ligne avant de rembourser :'}</div>
                {p.approveItems.map(it => (
                  <div key={it.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate text-slate-300">{it.name_fr}</span>
                    <select
                      value={p.disp[it.id] ?? DEFAULT_DISPOSITION[r.reason]}
                      onChange={e => p.onDisp(it.id, e.target.value as ReturnDisposition)}
                      className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg px-2 py-1 text-xs">
                      {RETURN_DISPOSITIONS.map(d => <option key={d} value={d}>{isAr ? DISP_LABEL[d].ar : DISP_LABEL[d].fr}</option>)}
                    </select>
                  </div>
                ))}
                <div className="flex gap-2">
                  <button type="button" onClick={() => p.onConfirmApprove(r)} disabled={p.busy}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold">
                    {isAr ? 'تأكيد القبول' : 'Confirmer l’approbation'}
                  </button>
                  <button type="button" onClick={p.onCancelApprove} disabled={p.busy}
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
  );
});
