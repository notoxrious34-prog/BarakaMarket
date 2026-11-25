import React, { memo, useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { formatDZD } from '../../core/display';
import type { Product } from '../../types';

/**
 * ADR-053 P3 — POIDS weight strip. Armed by #N / tile tap / Alt+N on a POIDS
 * article: the cashier picks NET grams (chips + custom), never a blind 1 kg.
 * Line math: qty_kg = grams/1000 × product.sell_price (which mirrors the
 * owner-set price_per_kg — the manager modal enforces that single truth).
 * Last-used grams per article persist locally (speed, not fiscal truth).
 */
interface Props {
  product: Product;
  mult: number;
  onClose: () => void;
}

const LAST_KEY = 'baraka_poids_last_v1';
const CHIPS = [100, 250, 500, 1000];

function lastUsed(productId: number): number | null {
  try {
    const m = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, number>;
    const g = m[String(productId)];
    return Number.isInteger(g) && (g as number) > 0 ? (g as number) : null;
  } catch {
    return null;
  }
}

function remember(productId: number, grams: number): void {
  try {
    const m = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, number>;
    m[String(productId)] = grams;
    localStorage.setItem(LAST_KEY, JSON.stringify(m));
  } catch { /* speed hint only — never breaks the sale */ }
}

export const PoidsWeightModal: React.FC<Props> = memo(function PoidsWeightModal({ product, mult, onClose }) {
  const { addToCart } = useCart();
  const hint = useMemo(() => lastUsed(product.id), [product.id]);
  const [grams, setGrams] = useState<number>(hint ?? 500);
  const [custom, setCustom] = useState('');
  const kgPrice = product.price_per_kg ?? product.sell_price;
  const lineTotal = (grams / 1000) * product.sell_price;

  const confirm = (g: number) => {
    if (!Number.isFinite(g) || g <= 0 || g > 50000) return;
    remember(product.id, Math.round(g));
    for (let i = 0; i < mult; i += 1) addToCart(product, g / 1000);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-sky-700 bg-slate-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Poids — ${product.name_fr}`}
      >
        <div className="flex items-center gap-2 text-sky-200 font-black">
          <Scale className="w-5 h-5" />
          <span className="truncate">{product.name_fr}</span>
        </div>
        <div className="mt-1 text-xs text-slate-400 font-mono" dir="ltr">
          {formatDZD(kgPrice, false)}/kg{product.tare_g ? ` · tare ${product.tare_g} g` : ''}{mult > 1 ? ` · ×${mult}` : ''}
        </div>
        {hint != null && (
          <button
            onClick={() => setGrams(hint)}
            className="mt-2 rounded-lg bg-sky-800/60 px-2.5 py-1 text-xs font-bold text-sky-100 hover:bg-sky-800"
          >
            Dernière fois: {hint} g 📌 — reprendre
          </button>
        )}
        <div className="mt-3 grid grid-cols-4 gap-2">
          {CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => setGrams(c)}
              className={`rounded-xl border py-2.5 font-mono font-black text-sm transition-all ${
                grams === c ? 'border-sky-400 bg-sky-700 text-white' : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-sky-500'
              }`}
              dir="ltr"
            >
              {c} g
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter' && custom) setGrams(parseInt(custom, 10)); }}
            placeholder="Grammes…"
            inputMode="numeric"
            className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-white"
            dir="ltr"
          />
          <button
            onClick={() => custom && setGrams(parseInt(custom, 10))}
            className="rounded-xl bg-slate-700 px-3 text-sm font-bold text-white hover:bg-slate-600"
          >
            OK
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono font-black text-lg text-emerald-300" dir="ltr">
            {grams} g = {formatDZD(lineTotal, false)}
          </span>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => confirm(grams)}
            className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-black text-white hover:bg-emerald-500"
          >
            Ajouter ✓
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-600 px-4 py-2.5 font-bold text-slate-300 hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
});
