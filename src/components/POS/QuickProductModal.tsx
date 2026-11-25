import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useCart } from '../../context/CartContext';
import { X, Zap } from 'lucide-react';
import {
  buildRapideAdd, validateRapideInput,
  type RapideTva, type RapideUnit, type RapideError,
} from '../../core/rapide';
import { calculateLineTotals } from '../../core/cart-bridge';
import { formatDZD } from '../../core/display';

interface Props {
  onClose: () => void;
  initialLabel?: string;
}

const ERR_TEXT: Record<RapideError, { ar: string; fr: string }> = {
  LABEL: { ar: 'التسمية مطلوبة (حرفان على الأقل)', fr: 'Libellé requis (2 caractères min)' },
  PRICE: { ar: 'السعر موجب بالدينار (مثال: 30 أو 30,50)', fr: 'Prix strictement positif en DZD' },
  QTY: { ar: 'الكمية موجبة (مثال: 2 أو 0,5 للوزن)', fr: 'Quantité strictement positive' },
  TVA: { ar: 'اختر الضريبة (0% تتطلب مديرًا)', fr: 'TVA obligatoire (0% = gérant)' },
};

/**
 * ADR-051 P0 — Produit Rapide modal. Same shell contract as CatalogSearchModal
 * (z-70, Escape, autofocus, caller rearms the scanner). TVA choice is explicit
 * (no silent default); 0% is role-gated (R3), never a new PIN infra.
 */
export const QuickProductModal: React.FC<Props> = ({ onClose, initialLabel = '' }) => {
  const { language, session } = useApp();
  const { addToCart } = useCart();
  const isAr = language === 'ar';
  const isCashier = session?.role === 'cashier';

  const [label, setLabel] = useState(initialLabel);
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<RapideUnit>('PIECE');
  const [tva, setTva] = useState<RapideTva | null>(null);
  const [errs, setErrs] = useState<RapideError[]>([]);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => { labelRef.current?.focus(); }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  const toCt = (s: string): number => {
    const n = parseFloat(s.replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };
  const toQty = (s: string): number => {
    const n = parseFloat(s.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };

  const tvaEff: RapideTva = tva ?? 9;
  const preview = (() => {
    try {
      const ct = toCt(price);
      const q = toQty(qty);
      if (!Number.isInteger(ct) || ct <= 0 || !(q > 0)) return null;
      return calculateLineTotals(ct / 100, q, tvaEff, 0);
    } catch { return null; }
  })();

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const input = { label, priceTtcCt: toCt(price), quantity: toQty(qty), tva: (tva ?? 99) as RapideTva, unit };
    const v = validateRapideInput(input);
    if (tva === 0 && isCashier) v.push('TVA');
    setErrs(v);
    if (v.length > 0) return;
    const r = buildRapideAdd({ ...input, tva: tva as RapideTva });
    addToCart(r.product, r.quantity, 0, r.pack);
    onClose();
  };

  const tvaChip = (v: RapideTva, txt: string, locked?: boolean) => (
    <button
      key={v}
      type="button"
      disabled={locked}
      onClick={() => setTva(v)}
      className={`flex-1 py-2 rounded-xl text-sm font-black border transition-all cursor-pointer ${locked
        ? 'bg-[#111722] text-slate-600 border-dashed border-[#2b3a4f] cursor-not-allowed'
        : tva === v
          ? 'bg-amber-600/20 text-amber-300 border-amber-500'
          : 'bg-[#111722] text-slate-300 border-[#2b3a4f] hover:border-amber-600/50'}`}
    >
      {txt}{locked ? ' 🔒' : ''}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 pt-[10vh]">
      <form
        onSubmit={submit}
        className="bg-[#0b0f17] border border-[#2b3a4f] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
      >
        <div className="p-3 border-b border-[#1e293b] flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-black text-white">
            {isAr ? 'منتج سريع — بلا كود بار' : 'Produit rapide — sans code-barres'}
          </span>
          <span className="ms-auto" />
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] font-bold text-slate-400 block mb-1">
              {isAr ? 'التسمية (تُطبع في التذكرة)' : 'Libellé (imprimé sur le ticket)'}
            </label>
            <input
              ref={labelRef}
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={isAr ? 'مثال: خبز الشعير — مخبزة النور' : 'Ex : Pain d\u2019orge — boulangerie'}
              className="w-full bg-[#111722] border border-[#233145] focus:border-emerald-500 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 outline-none"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[11px] font-bold text-slate-400 block mb-1">
                {isAr ? 'السعر TTC (دج)' : 'Prix TTC (DZD)'}
              </label>
              <input
                value={price}
                onChange={e => setPrice(e.target.value.replace(/[^0-9.,]/g, ''))}
                placeholder="30"
                inputMode="decimal"
                dir="ltr"
                className="w-full bg-[#111722] border border-[#233145] focus:border-emerald-500 rounded-xl px-3 py-2 text-sm text-white font-mono text-left placeholder-slate-500 outline-none tabular-nums"
              />
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-bold text-slate-400 block mb-1">
                {isAr ? 'الكمية' : 'Quantité'}
              </label>
              <input
                value={qty}
                onChange={e => setQty(e.target.value.replace(/[^0-9.,]/g, ''))}
                inputMode="decimal"
                dir="ltr"
                className="w-full bg-[#111722] border border-[#233145] focus:border-emerald-500 rounded-xl px-3 py-2 text-sm text-white font-mono text-left placeholder-slate-500 outline-none tabular-nums"
              />
            </div>
            <div className="w-24">
              <label className="text-[11px] font-bold text-slate-400 block mb-1">
                {isAr ? 'الوحدة' : 'Unité'}
              </label>
              <div className="flex bg-[#111722] border border-[#233145] rounded-xl overflow-hidden">
                {(['PIECE', 'KG'] as RapideUnit[]).map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    className={`flex-1 py-2 text-xs font-black cursor-pointer ${unit === u ? 'bg-emerald-600/30 text-emerald-300' : 'text-slate-500'}`}
                  >
                    {u === 'KG' ? 'g' : 'u'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 block mb-1">
              {isAr ? 'الضريبة TVA (اختيار إجباري)' : 'TVA (choix obligatoire)'}
            </label>
            <div className="flex gap-2">
              {tvaChip(0, '0%', isCashier)}
              {tvaChip(9, '9%')}
              {tvaChip(19, '19%')}
            </div>
            {isCashier && (
              <p className="text-[11px] text-amber-400/80 mt-1">
                {isAr ? 'شريحة 0% تتطلب دور مدير — بدّل المستخدم' : 'La tranche 0% exige un gérant — changez d\u2019utilisateur'}
              </p>
            )}
          </div>

          {preview && (
            <div className="bg-[#0e141f] border border-[#1e293b] rounded-xl px-3 py-2 text-xs flex justify-between" dir="ltr">
              <span className="text-slate-400">HT {formatDZD(preview.total_line_ht, false)}</span>
              <span className="text-slate-400">TVA +{formatDZD(preview.total_line_tva, false)}</span>
              <span className="text-emerald-400 font-black font-mono">{formatDZD(preview.total_line_ttc, false)}</span>
            </div>
          )}

          {errs.length > 0 && (
            <div className="text-[11px] text-rose-400 space-y-0.5">
              {errs.map(e => <p key={e}>• {isAr ? ERR_TEXT[e].ar : ERR_TEXT[e].fr}</p>)}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-[#1e293b] flex gap-2">
          <button
            type="submit"
            className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl text-sm font-black cursor-pointer"
          >
            {isAr ? 'إضافة للسلة (Enter)' : 'Ajouter au panier (Entrée)'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-transparent border border-[#2b3a4f] text-slate-400 hover:text-white rounded-xl text-sm cursor-pointer"
          >
            {isAr ? 'إلغاء (Esc)' : 'Annuler (Échap)'}
          </button>
        </div>
      </form>
    </div>
  );
};
