import React, { memo } from 'react';
import type { CashLiveStatus } from '../../core/cash-snapshot';

/**
 * CloseSummaryPanel.tsx — MKT-010 island (verbatim from CashSessionsView).
 * The live till card: cashier, float, cash sales, theoretical + trails.
 */

interface Props {
  live: CashLiveStatus;
  isAr: boolean;
  dz: (ct: number) => string;
}

export const CloseSummaryPanel: React.FC<Props> = memo(function CloseSummaryPanel({ live, isAr, dz }: Props) {
  const card = 'bg-[#101724] border border-[#1e293b] rounded-xl p-4';
  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-emerald-300">{isAr ? 'الجلسة الحالية' : 'Session en cours'}</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-bold">OPEN</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div><span className="text-slate-500 block">{isAr ? 'الكاشير' : 'Caissier'}</span><span className="text-white font-semibold">{live.session.cashierName}</span></div>
        <div><span className="text-slate-500 block">{isAr ? 'الافتتاح' : 'Fond'}</span><span className="text-white font-mono">{dz(live.openingFloatCt)}</span></div>
        <div><span className="text-slate-500 block">{isAr ? 'مبيعات نقدية' : 'Ventes espèces'}</span><span className="text-white font-mono">{dz(live.cashSalesCt)}</span></div>
        <div><span className="text-slate-500 block">{isAr ? 'النظري' : 'Théorique'}</span><span className="text-emerald-300 font-mono font-bold">{dz(live.theoreticalCashCt)}</span></div>
        <div><span className="text-slate-500 block">{isAr ? 'تحصيل ديون' : 'Encaissé créances'}</span><span className="text-white font-mono">{dz(live.settlementsCashCt)}</span></div>
        <div><span className="text-slate-500 block">{isAr ? 'إيداع/سحب/مصاريف' : 'Dépôt/Retrait/Dép.'}</span><span className="text-white font-mono">{dz(live.depositsCt)} / {dz(live.withdrawalsCt)} / {dz(live.expensesCt)}</span></div>
        <div><span className="text-slate-500 block">{isAr ? 'الفواتير' : 'Tickets'}</span><span className="text-white font-mono">{live.totalSalesCount}</span></div>
      </div>
    </div>
  );
});
