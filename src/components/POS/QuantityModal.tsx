import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useCart } from '../../context/CartContext';
import { formatDZD } from '../../core/display';
import { X, Check } from 'lucide-react';

interface Props {
  itemIndex: number;
  onClose: () => void;
}

/** F2 — rapid quantity override for the active cart line. Enter applies, focus re-arms. */
export const QuantityModal: React.FC<Props> = ({ itemIndex, onClose }) => {
  const { language } = useApp();
  // TASK-MKT-001: cart line from the isolated CartContext.
  const { currentCart, updateCartItemQty } = useCart();
  const isAr = language === 'ar';
  const item = currentCart[itemIndex];
  const [val, setVal] = useState(item ? String(item.quantity) : '1');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!item) return null;

  const apply = () => {
    const q = parseFloat(val.replace(',', '.'));
    if (Number.isFinite(q) && q > 0 && q < 10000) updateCartItemQty(itemIndex, q);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1e293b] flex items-center justify-between bg-[#0b0f17]">
          <h3 className="text-sm font-bold text-white">{isAr ? 'تعديل الكمية (F2)' : 'Quantité (F2)'}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-slate-300 truncate">{isAr ? item.name_ar : item.name_fr}</div>
          <div className="text-[11px] text-slate-500" dir="ltr">{formatDZD(item.unit_price_ttc, false)} / {item.unit}</div>
          <form onSubmit={e => { e.preventDefault(); apply(); }}>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={val}
              onChange={e => setVal(e.target.value)}
              className="w-full bg-[#162030] border border-[#2b3a4f] focus:border-emerald-500 rounded-xl px-3 py-2.5 text-lg font-mono text-white text-center outline-none"
              dir="ltr"
            />
          </form>
          <button onClick={apply} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer">
            <Check className="w-4 h-4" /> {isAr ? 'تأكيد (Enter)' : 'Appliquer (Enter)'}
          </button>
        </div>
      </div>
    </div>
  );
};
