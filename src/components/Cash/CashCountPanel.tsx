import React, { memo } from 'react';
import type { CashLiveStatus, CashCloseResult } from '../../core/cash-snapshot';

/**
 * CashCountPanel.tsx — MKT-010 island (verbatim from CashSessionsView).
 * The close card: theoretical vs counted, live gap, B4 reason gate,
 * F4 negative guard (in the view's onClose), close button + last Z verdict.
 */

interface Props {
  live: CashLiveStatus;
  isAr: boolean;
  dz: (ct: number) => string;
  counted: string;
  onCounted: (v: string) => void;
  closeReason: string;
  onCloseReason: (v: string) => void;
  liveDiffCt: number | null;
  closeBlocked: boolean;
  lastZ: CashCloseResult | null;
  onClose: () => void;
}

export const CashCountPanel: React.FC<Props> = memo(function CashCountPanel({
  live, isAr, dz, counted, onCounted, closeReason, onCloseReason,
  liveDiffCt, closeBlocked, lastZ, onClose,
}: Props) {
  const card = 'bg-[#101724] border border-[#1e293b] rounded-xl p-4';
  const input = 'w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white';
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors';
  return (
    <div className={card}>
      <h3 className="text-xs font-bold text-amber-300 mb-3">{isAr ? 'الإغلاق وتقرير Z' : 'Clôture & Rapport Z'}</h3>
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'النظري (متوقع)' : 'Théorique (attendu)'}</label>
          <div className="font-mono text-sm text-emerald-300 font-bold" dir="ltr">{dz(live.theoreticalCashCt)}</div>
        </div>
        <div className="flex-1">
          <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'النقد المحسوب (دج)' : 'Espèces comptées (DZD)'}</label>
          <input className={`${input} font-mono`} type="number" value={counted} onChange={e => onCounted(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الفرق المباشر' : 'Écart en direct'}</label>
          <div className={`font-mono text-sm font-bold ${liveDiffCt === null ? 'text-slate-500' : liveDiffCt === 0 ? 'text-emerald-300' : liveDiffCt > 0 ? 'text-amber-300' : 'text-rose-300'}`} dir="ltr">
            {liveDiffCt === null ? '—' : `${dz(liveDiffCt)}${liveDiffCt === 0 ? (isAr ? ' مثالي' : ' PARFAIT') : liveDiffCt > 0 ? (isAr ? ' فائض' : ' EXCÉDENT') : (isAr ? ' عجز' : ' DÉFICIT')}`}
          </div>
        </div>
      </div>
      {/* B4: a non-zero gap closes ONLY with a written reason (goes to notes + z.close audit). */}
      {(liveDiffCt !== null && liveDiffCt !== 0) && (
        <div className="mt-2">
          <label className="text-[11px] text-amber-300 block mb-1">{isAr ? 'سبب الفرق (إلزامي للإغلاق)' : 'Motif de l’écart (obligatoire) :'}</label>
          <input className={input} value={closeReason} onChange={e => onCloseReason(e.target.value)} placeholder={isAr ? 'مثال: فرق صرف، خطأ عد...' : 'Ex : erreur de rendu, différence de comptage…'} />
        </div>
      )}
      <div className="flex gap-3 items-end mt-2">
        <button
          className={`${btn} ${closeBlocked ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
          disabled={closeBlocked}
          title={closeBlocked ? (isAr ? 'اكتب سبب الفرق أولاً' : 'Motif requis d’abord') : undefined}
          onClick={onClose}
        >
          {isAr ? 'إغلاق وطبع Z' : 'Clôturer + Z'}
        </button>
      </div>
      {lastZ && (
        <div className="mt-3 text-[11px] bg-[#0b0f17] border border-[#2b3a4f] rounded-lg p-3 font-mono">
          <div className="text-white font-bold">{lastZ.zNumber}</div>
          <div className={lastZ.cashDiffCt === 0 ? 'text-emerald-300' : lastZ.cashDiffCt > 0 ? 'text-amber-300' : 'text-rose-300'}>
            {isAr ? 'الفرق: ' : 'Écart: '}{dz(lastZ.cashDiffCt)} {lastZ.cashDiffCt === 0 ? (isAr ? 'مثالي' : 'PARFAIT') : lastZ.cashDiffCt > 0 ? (isAr ? 'فائض' : 'EXCÉDENT') : (isAr ? 'عجز' : 'DÉFICIT')}
          </div>
          <div className="text-slate-500 break-all">hash {lastZ.hash.slice(0, 32)}…</div>
        </div>
      )}
    </div>
  );
});
