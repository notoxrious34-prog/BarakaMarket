import React, { memo } from 'react';
import { Copy, Printer, Receipt, X } from 'lucide-react';
import { formatDZD, formatDZDFromCt } from '../../core/display';
import type { SalesBookDetail } from '../../core/sales-book-authority';

/**
 * SalesDetailDock.tsx — MKT-007 island (verbatim from SalesBookView §03).
 * The side dock: receipt lines, tax totals, governed duplicata.
 */

interface Props {
  detail: SalesBookDetail | null;
  detailErr: string | null;
  dupReason: string;
  onDupReason: (v: string) => void;
  dupBusy: boolean;
  actor: string;
  isAr: boolean;
  onClose: () => void;
  onDuplicata: () => void;
}

export const SalesDetailDock: React.FC<Props> = memo(function SalesDetailDock({
  detail, detailErr, dupReason, onDupReason, dupBusy, actor, isAr, onClose, onDuplicata,
}: Props) {
  return (
    <aside data-testid="sales-detail" className="lg:sticky lg:top-4 bg-[#111722] border border-emerald-500/25 rounded-2xl p-4 space-y-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">03</span>
        <Receipt className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-black text-white">{isAr ? 'تفاصيل الوصل' : 'Détail du ticket'}</h3>
        {(detail || detailErr) && (
          <button type="button" onClick={onClose}
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
              <input value={dupReason} onChange={e => onDupReason(e.target.value.slice(0, 140))}
                placeholder={isAr ? 'سبب إعادة الطبع (اختياري)…' : 'Motif (optionnel)…'}
                className="flex-1 min-w-40 bg-[#162030] border border-[#2b3a4f] rounded-lg px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-emerald-500" />
              <button type="button" onClick={onDuplicata} disabled={dupBusy}
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
  );
});
