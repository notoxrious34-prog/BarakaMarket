import React, { memo } from 'react';
import { Search, Receipt } from 'lucide-react';
import { RETURN_REASONS } from '../../types/index';
import type { ReturnReasonCode } from '../../types/index';
import type { ReturnSaleLookup } from '../../core/returns-authority';
import { fmtUnitQty, REASON_LABEL } from './returns-panels-shared';

/**
 * MKT-006 island 01 — smart FACT lookup + draft composer.
 * Memo: re-renders only when its own slice changes (never on drafts/claims).
 */
export interface ReturnLookupPanelProps {
  isAr: boolean;
  lookupKey: string;
  onLookupKey: (v: string) => void;
  lookup: ReturnSaleLookup | null;
  lookupMsg: string | null;
  looking: boolean;
  picked: Record<number, number>;
  onTogglePick: (saleItemId: number, checked: boolean, unit: string, remainingMilli: number) => void;
  onPickQty: (saleItemId: number, v: number) => void;
  reason: ReturnReasonCode;
  onReason: (r: ReturnReasonCode) => void;
  reasonNote: string;
  onReasonNote: (v: string) => void;
  busy: boolean;
  onLookup: () => void;
  onCreate: () => void;
}

export const ReturnLookupPanel: React.FC<ReturnLookupPanelProps> = memo(function ReturnLookupPanel(p) {
  const { isAr } = p;
  return (
    <section className="bg-[#111722] border border-amber-500/20 rounded-2xl p-4 space-y-3 shadow-xl">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25">01</span>
        <Receipt className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-black text-white">{isAr ? 'البحث عن الفاتورة' : 'Recherche de facture'}</h3>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={p.lookupKey}
          autoFocus
          onChange={e => p.onLookupKey(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') p.onLookup(); }}
          placeholder={isAr ? 'FACT-2026-000042 … أو 42 … أو امسح/الصق' : 'FACT-2026-000042 … ou 42 … ou scannez'}
          className="flex-1 bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
          dir="ltr"
        />
        <button type="button" onClick={p.onLookup} disabled={p.looking || !p.lookupKey.trim()}
          className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 font-bold text-sm flex items-center gap-2 justify-center">
          <Search className="w-4 h-4" />{p.looking ? '…' : isAr ? 'بحث' : 'Chercher'}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">{isAr ? 'يقبل: الرقم الكامل، الأرقام الأخيرة فقط، ولو بأحرف صغيرة — والماسح يرسل تلقائياً بزر Enter.' : 'Accepte : numéro complet, derniers chiffres, minuscules — le scanneur valide via Entrée.'}</p>
      {p.lookupMsg && <div className="text-sm text-red-300 font-bold">{p.lookupMsg}</div>}

      {p.lookup && (
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-mono font-bold text-amber-300">{p.lookup.sale.invoice_number}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${p.lookup.sale.status === 'COMPLETED' ? 'bg-emerald-900 text-emerald-200' : 'bg-red-900 text-red-200'}`}>{p.lookup.sale.status}</span>
            <span className="text-slate-400">{p.lookup.sale.payment_method}</span>
            <span className="text-slate-400 font-mono">{p.lookup.sale.total_ttc_ct / 100} دج</span>
          </div>
          <div className="space-y-2">
            {p.lookup.items.map(it => (
              <div key={it.sale_item_id} className="flex items-center gap-3 bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2">
                <input type="checkbox" className="w-4 h-4 accent-amber-500"
                  checked={it.sale_item_id in p.picked}
                  disabled={it.remaining_milli <= 0}
                  onChange={e => p.onTogglePick(it.sale_item_id, e.target.checked, it.unit, it.remaining_milli)}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">{it.name_fr}</div>
                  <div className="text-xs text-slate-400">
                    {isAr ? 'المباع' : 'Vendu'} {fmtUnitQty(it.qty_milli, it.unit)}
                    {' · '}{isAr ? 'المتبقي' : 'Reliquat'} <span className="text-emerald-300 font-bold">{fmtUnitQty(it.remaining_milli, it.unit)}</span>
                  </div>
                </div>
                <input type="number" min={0} step={it.unit === 'PIECE' ? 1 : 1} dir="ltr"
                  value={p.picked[it.sale_item_id] ?? ''}
                  disabled={!(it.sale_item_id in p.picked)}
                  onChange={e => p.onPickQty(it.sale_item_id, Number(e.target.value))}
                  className="w-24 bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-sm font-mono text-center disabled:opacity-30"
                />
                <span className="text-xs text-slate-500 w-8">{it.unit === 'PIECE' ? (isAr ? 'قطع' : 'pcs') : it.unit === 'KG' ? 'غ' : 'مل'}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={p.reason} onChange={e => p.onReason(e.target.value as ReturnReasonCode)}
              className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2.5 text-sm">
              {RETURN_REASONS.map(r => <option key={r} value={r}>{isAr ? REASON_LABEL[r].ar : REASON_LABEL[r].fr}</option>)}
            </select>
            <input value={p.reasonNote} onChange={e => p.onReasonNote(e.target.value.slice(0, 140))}
              placeholder={isAr ? 'ملاحظة (اختيارية، 140)' : 'Note (optionnel, 140)'}
              className="flex-1 bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-3 py-2.5 text-sm placeholder:text-slate-600" />
            <button type="button" onClick={p.onCreate} disabled={p.busy}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 font-bold text-sm">
              {isAr ? 'حفظ مسودة' : 'Brouillon'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
});
