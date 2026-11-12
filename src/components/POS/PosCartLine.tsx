import React, { memo } from 'react';
import { Trash2, Minus, Plus } from 'lucide-react';
import { formatDZD, formatGrams } from '../../core/display';
import type { SaleItem } from '../../types';

/**
 * TASK-MKT-004: one cart line — memoized so editing line N never
 * re-renders sibling lines (the 50-scans/min hot path).
 * Callbacks are the stable CartContext mutators.
 */
interface PosCartLineProps {
  item: SaleItem;
  index: number;
  isAr: boolean;
  onQty: (index: number, qty: number) => void;
  onRemove: (index: number) => void;
}

export const PosCartLine: React.FC<PosCartLineProps> = memo(function PosCartLine({ item, index, isAr, onQty, onRemove }) {
  const step = item.unit === 'KG' ? 0.25 : 1;
  return (
    <div
      key={`${item.product_id}-${index}`}
      className="bg-[#111722] border border-[#1e293b] rounded-xl p-2.5 flex items-center justify-between gap-2 shadow-sm hover:border-[#2d3f56] transition-all"
    >
      {/* Item Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-200 truncate">
            {isAr ? item.name_ar : item.name_fr}
          </span>
          <span
            className={`text-[9px] font-bold px-1 py-0.2 rounded ${
              item.tva_rate === 0
                ? 'bg-sky-950/80 text-sky-400'
                : item.tva_rate === 9
                ? 'bg-amber-950/80 text-amber-400'
                : 'bg-purple-950/80 text-purple-400'
            }`}
          >
            {item.tva_rate}%
          </span>
        </div>

        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
          {/* B3: pure-LTR numeric run — no more DZD 080 1 jumble in RTL */}
          <span dir="ltr">
            {item.unit === 'KG' ? formatGrams(item.quantity) : `${item.quantity} x`} {formatDZD(item.unit_price_ttc, false)}
          </span>
          {item.discount_percent > 0 && (
            <span className="text-rose-400 font-semibold">
              -{item.discount_percent}%
            </span>
          )}
        </div>
      </div>

      {/* Quantity Controls & Line Total — B3: stepper locked LTR (± never
          mirrors in RTL), qty is an inline numeric field: 12 bottles
          = type 12 + Enter, no modal round-trip. */}
      <div className="flex items-center gap-2">
        <div dir="ltr" className="flex items-center bg-[#162030] rounded-lg border border-[#2b3a4f] p-0.5">
          <button
            onClick={() => onQty(index, item.quantity - step)}
            className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-white hover:bg-[#233145] rounded cursor-pointer"
          >
            <Minus className="w-3 h-3" />
          </button>
          <input
            value={item.unit === 'KG' ? String(Math.round(item.quantity * 1000)) : String(item.quantity)}
            inputMode="decimal"
            aria-label={isAr ? 'الكمية' : 'Quantité'}
            onChange={e => {
              const v = parseFloat(e.target.value.replace(',', '.'));
              if (Number.isNaN(v) || v < 0) return;
              onQty(index, item.unit === 'KG' ? Math.round(v) / 1000 : Math.floor(v));
            }}
            className="w-12 text-center text-xs font-bold text-white bg-transparent outline-none border-b border-transparent focus:border-amber-400 [appearance:textfield]"
          />
          <button
            onClick={() => onQty(index, item.quantity + step)}
            className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-white hover:bg-[#233145] rounded cursor-pointer"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        <div className="text-end min-w-[70px]">
          <div className="text-xs font-bold text-emerald-400">
            {formatDZD(item.total_line_ttc, false)}
          </div>
        </div>

        <button
          onClick={() => onRemove(index)}
          className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});
