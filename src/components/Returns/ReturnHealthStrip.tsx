import React, { memo } from 'react';
import type { ReturnsHealth } from '../../core/returns-health';

/**
 * ReturnHealthStrip.tsx — ADR-045 island (mirrors SalesHealthGrid).
 * The manager's one-glance workload: drafts · approved · quarantine · claims.
 */
export const ReturnHealthStrip: React.FC<{ health: ReturnsHealth; isAr: boolean }> = memo(
  function ReturnHealthStrip({ health, isAr }) {
    const cards = [
      { l: isAr ? 'مسودات' : 'Brouillons', v: health.drafts, c: 'text-amber-300' },
      { l: isAr ? 'مقبول' : 'Approuvés', v: health.approved, c: 'text-emerald-300' },
      { l: isAr ? 'محجوز' : 'Quarantaine', v: health.quarantined, c: 'text-orange-300' },
      { l: isAr ? 'مطالبات مفتوحة' : 'Réclamations', v: health.openClaims, c: 'text-sky-300' },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        {cards.map(k => (
          <div key={k.l} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-2 py-2">
            <div className="text-[11px] text-slate-500 font-bold">{k.l}</div>
            <div className={`font-mono font-black text-lg ${k.c}`} dir="ltr">{k.v}</div>
          </div>
        ))}
      </div>
    );
  },
);
