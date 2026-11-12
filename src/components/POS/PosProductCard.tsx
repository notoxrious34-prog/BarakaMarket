import React, { memo } from 'react';
import { Scale } from 'lucide-react';
import { formatDZD, formatGrams } from '../../core/display';
import type { Product } from '../../types';

/**
 * TASK-MKT-004: one catalog card — memoized so cart edits never
 * re-render the grid (onAdd is the stable CartContext mutator).
 */
interface PosProductCardProps {
  product: Product;
  isAr: boolean;
  onAdd: (product: Product, qty: number) => void;
}

export const PosProductCard: React.FC<PosProductCardProps> = memo(function PosProductCard({ product, isAr, onAdd }) {
  const isPerishableSoon =
    product.has_expiry_date &&
    product.expiry_date &&
    new Date(product.expiry_date) < new Date(Date.now() + 15 * 24 * 3600 * 1000);

  return (
    <div
      key={product.id}
      onClick={() => onAdd(product, 1)}
      className="bg-[#111722] hover:bg-[#162030] border border-[#1e293b] hover:border-emerald-500/50 rounded-xl p-2.5 flex flex-col justify-between transition-all cursor-pointer shadow-sm hover:shadow-lg hover:shadow-emerald-950/20 group relative"
    >
      {/* TVA Rate Badge */}
      <div className="flex items-center justify-between mb-1.5">
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            product.tva_rate === 0
              ? 'bg-sky-950/80 text-sky-400 border border-sky-800/40'
              : product.tva_rate === 9
              ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40'
              : 'bg-purple-950/80 text-purple-400 border border-purple-800/40'
          }`}
        >
          TVA {product.tva_rate}%
        </span>

        {product.is_scale_product && (
          <span className="text-[10px] bg-emerald-950/80 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800/40 flex items-center gap-0.5">
            <Scale className="w-2.5 h-2.5" />
            <span>g</span>
          </span>
        )}
      </div>

      {/* Name FR & AR */}
      <div className="my-1">
        <h4 className="text-xs font-semibold text-slate-200 group-hover:text-emerald-400 transition-colors line-clamp-2">
          {isAr ? product.name_ar : product.name_fr}
        </h4>
        <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
          {isAr ? product.name_fr : product.name_ar}
        </p>
      </div>

      {/* Expiry Warning if near */}
      {isPerishableSoon && (
        <div className="text-[10px] font-bold uppercase tracking-wide bg-rose-600 text-white px-1.5 py-0.5 rounded shadow-sm mb-1 flex items-center gap-1">
          <span>{isAr ? 'قريب الانتهاء' : 'Date courte'}</span>
        </div>
      )}

      {/* Price & Stock */}
      <div className="mt-1 pt-1.5 border-t border-[#1e293b] flex items-center justify-between">
        <span className="text-sm font-bold text-emerald-400" dir="ltr">
          {formatDZD(product.sell_price, false)}
        </span>
        <span className="text-[10px] text-slate-400">
          {product.unit === 'KG' ? formatGrams(product.stock_qty) : `${product.stock_qty} u`}
        </span>
      </div>
    </div>
  );
});
