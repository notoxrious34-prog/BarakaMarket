import React, { memo } from 'react';
import { formatDZD } from '../../core/display';
import { calculateSaleTotals } from '../../core/cart-bridge';

type CartTotals = ReturnType<typeof calculateSaleTotals>;

/**
 * TASK-MKT-004: fiscal totals panel — pure presentational island.
 * Re-renders only when the totals object identity changes (cart edits).
 */
interface PosFiscalTotalsProps {
  cartTotals: CartTotals;
  isAr: boolean;
}

export const PosFiscalTotals: React.FC<PosFiscalTotalsProps> = memo(function PosFiscalTotals({ cartTotals, isAr }) {
  return (
    <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3 mt-2 shadow-inner">
      <div className="space-y-1.5 text-xs text-slate-400 pb-2 border-b border-[#1e293b]">
        <div className="flex justify-between">
          <span>{isAr ? 'المجموع بدون رسوم (Sous-Total HT):' : 'Sous-Total HT :'}</span>
          <span className="font-mono text-slate-200" dir="ltr">{formatDZD(cartTotals.total_ht)}</span>
        </div>

        {/* TVA breakdown by rate — zero rows hidden (B1: no +0.00 noise) */}
        {cartTotals.tva_breakdown[9].tva_amount > 0 && (
        <div className="flex justify-between text-[11px] text-slate-400 ps-2">
          <span>TVA 9% ({isAr ? 'قاعدة:' : 'Base :'} <span dir="ltr">{formatDZD(cartTotals.tva_breakdown[9].base_ht, false)}</span>)</span>
          <span className="font-mono text-amber-400" dir="ltr">+{formatDZD(cartTotals.tva_breakdown[9].tva_amount)}</span>
        </div>
        )}

        {cartTotals.tva_breakdown[19].tva_amount > 0 && (
        <div className="flex justify-between text-[11px] text-slate-400 ps-2">
          <span>TVA 19% ({isAr ? 'قاعدة:' : 'Base :'} <span dir="ltr">{formatDZD(cartTotals.tva_breakdown[19].base_ht, false)}</span>)</span>
          <span className="font-mono text-purple-400" dir="ltr">+{formatDZD(cartTotals.tva_breakdown[19].tva_amount)}</span>
        </div>
        )}

        {cartTotals.timbre_fiscal > 0 && (
        <div className="flex justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <span>{isAr ? 'حق الطابع المالي (Timbre Espèces 1%):' : 'Droit de Timbre (Espèces 1%) :'}</span>
          </span>
          <span className="font-mono text-amber-300" dir="ltr">
            +{formatDZD(cartTotals.timbre_fiscal)}
          </span>
        </div>
        )}
      </div>

      {/* Grand Total TTC */}
      <div className="pt-2 flex items-baseline justify-between">
        <span className="text-sm font-bold text-white tracking-wide">
          {isAr ? 'المجموع النهائي (TOTAL TTC):' : 'TOTAL À PAYER TTC :'}
        </span>
        <div className="text-end">
          <span className="text-2xl font-black text-emerald-400 font-mono tracking-tight" dir="ltr">
            {formatDZD(cartTotals.total_ttc, false)}
          </span>
        </div>
      </div>
    </div>
  );
});
