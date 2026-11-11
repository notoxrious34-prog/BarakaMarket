import React, { memo } from 'react';
import { Printer, RefreshCw, ClipboardList } from 'lucide-react';
import type { ReturnStatus } from '../../types/index';
import type { ReturnHead } from '../../core/returns-authority';
import { formatDZDFromCt } from '../../core/display';
import { STATUS_LABEL, REASON_LABEL } from './returns-panels-shared';

/**
 * MKT-006 island 02, ADR-045 slimmed — the drafts LIST only (Master).
 * Decisions moved verbatim to ReturnDecisionDock (Detail). Memo on the
 * drafts slice only. Rows are selectable; the list owns a named scroll box.
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
  selectedId: string | null;
  onSelect: (r: ReturnHead) => void;
  onOpenTicket: (id: string) => void;
}

export const ReturnDraftsPanel: React.FC<ReturnDraftsPanelProps> = memo(function ReturnDraftsPanel(p) {
  const { isAr } = p;
  return (
    <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25">02</span>
        <ClipboardList className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-black text-white">{isAr ? 'المسودات' : 'Brouillons'}</h3>
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
      {p.rows.length > 0 && (
        <div data-testid="returns-list" className="space-y-2 max-h-[52vh] overflow-y-auto pe-1">
          {p.rows.map(r => {
            const sel = p.selectedId === r.id;
            return (
              <button key={r.id} type="button" onClick={() => p.onSelect(r)}
                className={`w-full text-start bg-[#0b0f17] border rounded-xl px-3 py-2.5 transition-colors ${sel ? 'border-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,.5)]' : 'border-[#2b3a4f] hover:border-amber-700'}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                  <span className="font-mono font-bold text-amber-300">{r.return_number ?? r.id.slice(0, 8)}</span>
                  <span className="font-mono text-slate-400 text-xs">← {r.invoice_number}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.status === 'APPROVED' ? 'bg-emerald-900 text-emerald-200' : r.status === 'REJECTED' ? 'bg-red-900 text-red-200' : 'bg-yellow-900 text-yellow-200'}`}>
                    {isAr ? STATUS_LABEL[r.status].ar : STATUS_LABEL[r.status].fr}
                  </span>
                  <span className="text-xs text-slate-400">{isAr ? REASON_LABEL[r.reason].ar : REASON_LABEL[r.reason].fr}</span>
                  <span className="font-bold text-emerald-300">{formatDZDFromCt(r.refund_ct)}</span>
                  <span className="text-xs text-slate-500">{r.sale_day}{r.posting_day && r.posting_day !== r.sale_day ? ` → ${r.posting_day}` : ''}</span>
                  <span className="ms-auto flex items-center gap-2">
                    {r.status === 'APPROVED' && (
                      <span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); p.onOpenTicket(r.id); }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); p.onOpenTicket(r.id); } }}
                        className="px-3 py-1.5 rounded-lg bg-[#162030] border border-[#2b3a4f] text-xs font-bold flex items-center gap-1 hover:border-amber-500">
                        <Printer className="w-3.5 h-3.5" />{isAr ? 'الوصل' : 'Bon'}
                      </span>
                    )}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
});
