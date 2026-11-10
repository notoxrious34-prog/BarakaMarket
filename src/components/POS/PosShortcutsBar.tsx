import React, { memo } from 'react';

/**
 * TASK-MKT-004: static shortcuts legend — pure, memo, one prop.
 * Never re-renders with cart/clock state.
 */
interface PosShortcutsBarProps {
  isAr: boolean;
}

export const PosShortcutsBar: React.FC<PosShortcutsBarProps> = memo(function PosShortcutsBar({ isAr }) {
  return (
    <div className="mt-2 pt-2 border-t border-[#1e293b] bg-[#070a0f] px-3 py-1.5 rounded-lg flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2 flex-shrink-0">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-[#162030] text-emerald-400 font-mono rounded border border-[#2b3a4f]">F1</kbd>
          <span>{isAr ? 'البحث/الباركود' : 'Recherche/Code'}</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-[#162030] text-violet-400 font-mono rounded border border-[#2b3a4f]">F2</kbd>
          <span>{isAr ? 'الكمية' : 'Quantité'}</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-[#162030] text-violet-400 font-mono rounded border border-[#2b3a4f]">F3</kbd>
          <span>{isAr ? 'التخفيض' : 'Remise'}</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-[#162030] text-amber-400 font-mono rounded border border-[#2b3a4f]">F4</kbd>
          <span>{isAr ? 'تعليق الفاتورة' : 'Mettre attente'}</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-[#162030] text-amber-400 font-mono rounded border border-[#2b3a4f]">F5</kbd>
          <span>{isAr ? 'استرجاع الفاتورة' : 'Rappeler'}</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-[#162030] text-sky-400 font-mono rounded border border-[#2b3a4f]">F6</kbd>
          <span>{isAr ? 'الميزان' : 'Balance'}</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-[#162030] text-rose-400 font-mono rounded border border-[#2b3a4f]">F9</kbd>
          <span>{isAr ? 'الكريدي' : 'Crédit'}</span>
        </span>
      </div>

      <div className="flex items-center gap-1 font-semibold text-emerald-400">
        <kbd className="px-2 py-0.5 bg-emerald-950 text-emerald-300 font-mono rounded border border-emerald-700">Space</kbd>
        <span>{isAr ? 'إتمام الدفع نقداً' : 'Paiement Rapide'}</span>
      </div>
    </div>
  );
});
