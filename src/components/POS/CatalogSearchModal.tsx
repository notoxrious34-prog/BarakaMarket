import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useCart } from '../../context/CartContext';
import { formatDZD } from '../../core/display';
import { smartMatches } from '../../core/search-smart';
import { X, Search, Zap } from 'lucide-react';

interface Props {
  onClose: () => void;
  /** ADR-051 P1: no-match → create a rapide item prefilled with the query. */
  onCreateRapide?: (label: string) => void;
}

/**
 * F7 — instant obsidian catalog search. Auto-focused AR/FR input,
 * ArrowUp/Down navigation, Enter picks -> cart, focus re-arms to scanner.
 */
export const CatalogSearchModal: React.FC<Props> = ({ onClose, onCreateRapide }) => {
  const { products, language } = useApp();
  // TASK-MKT-001: picks land via the isolated CartContext.
  const { addToCart } = useCart();
  const isAr = language === 'ar';
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    // ADR-051 P1: smart matching (normalization + transliteration + AND).
    const pool = products.filter(p => smartMatches(p, q));
    return pool.slice(0, 30);
  }, [products, q]);

  useEffect(() => {
    setHi(0);
  }, [q]);

  const trimmed = q.trim();
  // ADR-051 P1: empty result + typed query → inline rapide creation (replaces "no results").
  const showCreate = onCreateRapide && trimmed.length >= 2 && results.length === 0;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHi(prev => Math.min(results.length - 1, prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHi(prev => Math.max(0, prev - 1));
      } else if (e.key === 'Enter') {
        const pick = results[hi];
        if (pick) {
          e.preventDefault();
          addToCart(pick, 1);
          onClose();
        } else if (showCreate) {
          e.preventDefault();
          onCreateRapide(trimmed);
        }
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [results, hi, addToCart, onClose, showCreate, onCreateRapide, trimmed]);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 pt-[10vh]">
      <div className="bg-[#0b0f17] border border-[#2b3a4f] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="p-3 border-b border-[#1e293b] flex items-center gap-2">
          <Search className="w-4 h-4 text-emerald-400 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={isAr ? 'ابحث بالعربية أو الفرنسية... (↑↓ + Enter)' : 'Nom, catégorie, code-barres... (↑↓ + Enter)'}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {showCreate ? (
            <button
              onClick={() => onCreateRapide(trimmed)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-start cursor-pointer bg-amber-950/40 border border-amber-600 hover:bg-amber-950/70"
            >
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs font-bold text-amber-200 truncate">
                  {isAr ? `⚡ إنشاء منتج سريع: «${trimmed}»` : `⚡ Créer rapide : «${trimmed}»`}
                </span>
                <span className="block text-[10px] text-amber-400/70">
                  {isAr ? 'Enter — ثم السعر + TVA' : 'Entrée — puis prix + TVA'}
                </span>
              </span>
            </button>
          ) : results.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-500">
              {isAr ? 'لا توجد نتائج' : 'Aucun article trouvé'}
            </div>
          )}
          {results.map((p, i) => (
            <button
              key={p.id}
              onMouseEnter={() => setHi(i)}
              onClick={() => { addToCart(p, 1); onClose(); }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-start cursor-pointer ${i === hi ? 'bg-emerald-950/70 border border-emerald-600' : 'border border-transparent hover:bg-[#162030]'}`}
            >
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-slate-100 truncate">{isAr ? p.name_ar : p.name_fr}</span>
                <span className="block text-[10px] text-slate-500 font-mono" dir="ltr">{p.barcode} • {p.unit}</span>
              </span>
              <span className="text-xs font-mono text-emerald-400 shrink-0" dir="ltr">{formatDZD(p.sell_price, false)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
