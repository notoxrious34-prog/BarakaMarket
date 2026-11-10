import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useCart } from '../../context/CartContext';
import { formatDZD } from '../../core/display';
import { X, Check, Percent } from 'lucide-react';

interface Props {
  itemIndex: number;
  onClose: () => void;
}

/**
 * F3 — line remise: percent (0-100) or fixed DZD (converted to % of line TTC
 * via deterministic centimes math). Enter applies, focus re-arms.
 */
export const DiscountModal: React.FC<Props> = ({ itemIndex, onClose }) => {
  const { language } = useApp();
  // TASK-MKT-001: cart line from the isolated CartContext.
  const { currentCart, updateCartItemDiscount } = useCart();
  const isAr = language === 'ar';
  const item = currentCart[itemIndex];
  const [mode, setMode] = useState<'pct' | 'dzd'>('pct');
  const [val, setVal] = useState(item && item.discount_percent > 0 ? String(item.discount_percent) : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [mode]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!item) return null;

  const apply = () => {
    const n = parseFloat(val.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) {
      onClose();
      return;
    }
    if (mode === 'pct') {
      updateCartItemDiscount(itemIndex, Math.min(100, n));
    } else {
      // Fixed DZD -> percent of gross line TTC (integer-safe, clamped).
      const gross = item.unit_price_ttc * item.quantity;
      const pct = gross > 0 ? (n / gross) * 100 : 0;
      updateCartItemDiscount(itemIndex, Math.max(0, Math.min(100, Math.round(pct * 100) / 100)));
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1e293b] flex items-center justify-between bg-[#0b0f17]">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Percent className="w-4 h-4 text-amber-400" />
            {isAr ? 'خصم السطر (F3)' : 'Remise ligne (F3)'}
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-slate-300 truncate">{isAr ? item.name_ar : item.name_fr}</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setMode('pct')}
              className={`py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${mode === 'pct' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-[#162030] border-[#2b3a4f] text-slate-400'}`}
            >
              % {isAr ? 'نسبة' : 'Pourcent'}
            </button>
            <button
              onClick={() => setMode('dzd')}
              className={`py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${mode === 'dzd' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-[#162030] border-[#2b3a4f] text-slate-400'}`}
            >
              DZD {isAr ? 'مبلغ' : 'Montant'}
            </button>
          </div>
          <form onSubmit={e => { e.preventDefault(); apply(); }}>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={val}
              onChange={e => setVal(e.target.value)}
              placeholder={mode === 'pct' ? '10' : formatDZD(0, false)}
              className="w-full bg-[#162030] border border-[#2b3a4f] focus:border-amber-500 rounded-xl px-3 py-2.5 text-lg font-mono text-white text-center outline-none"
              dir="ltr"
            />
          </form>
          <button onClick={apply} className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm font-bold cursor-pointer">
            {isAr ? 'تطبيق (Enter)' : 'Appliquer (Enter)'}
          </button>
        </div>
      </div>
    </div>
  );
};
