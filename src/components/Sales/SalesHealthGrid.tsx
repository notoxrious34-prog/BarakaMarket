import React, { memo } from 'react';
import { formatDZDFromCt } from '../../core/display';
import type { SalesBookHealth } from '../../core/sales-book-authority';

/**
 * SalesHealthGrid.tsx — MKT-007 island (verbatim from SalesBookView §01).
 * P4 day health: gross − AVOIR = net, per-method split.
 */

interface Props {
  health: SalesBookHealth;
  isAr: boolean;
}

export const SalesHealthGrid: React.FC<Props> = memo(function SalesHealthGrid({ health, isAr }: Props) {
  if (!(health.count > 0 || health.cancelled > 0)) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
      {[
        { l: isAr ? 'المجموع' : 'Brut', v: health.gross_ct, c: 'text-white' },
        { l: 'AVOIR', v: health.avoir_ct, c: 'text-amber-300' },
        { l: isAr ? 'الصافي' : 'Net', v: health.net_ct, c: 'text-emerald-300' },
        { l: isAr ? 'نقدي' : 'Espèces', v: health.especes_ct, c: 'text-slate-300' },
        { l: isAr ? 'بنكي + كريدي' : 'Banque + crédit', v: health.bank_ct + health.credit_ct, c: 'text-slate-300' },
      ].map(k => (
        <div key={k.l} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl px-2 py-2">
          <div className="text-[11px] text-slate-500 font-bold">{k.l}</div>
          <div className={`font-mono font-black text-sm ${k.c}`} dir="ltr">{formatDZDFromCt(k.v)}</div>
        </div>
      ))}
    </div>
  );
});
