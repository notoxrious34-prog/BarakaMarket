import React, { memo, useEffect, useMemo, useState } from 'react';
import { Pin } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatDZD } from '../../core/display';
import { scanBeep, errorBuzz } from '../../hardware/sound';
import { PoidsWeightModal } from './PoidsWeightModal';
import { PinManagerModal } from './PinManagerModal';
import type { Product } from '../../types';

/**
 * ADR-053 P3 — pinned catalog lane island (MKT-004: PosView stays lean).
 * Owns everything pin: DB overlay on mount (offline-safe), the tiles grid
 * (#1..#12, expiry-aware), Alt+1..9 (even from the scan field, never inside
 * a modal), the POIDS weight strip, and the owner pin board + button.
 * Taps/keys share the scan path via triggerPinnedSlot: PIECE/LIBRE join the
 * cart, POIDS arms the weight strip. POIDS tiles show the owner-set price/kg.
 */
interface Props {
  visible: boolean;
  /** True while locked or any POS modal is open — Alt+1..9 stays silent then. */
  suspended: boolean;
  onFeedback: (msg: string, ok: boolean) => void;
  rearm: () => void;
}

function isLive(p: Product, today: string): boolean {
  return p.pin_order != null && (!p.pinned_until || p.pinned_until >= today);
}

export const PosPinnedTiles: React.FC<Props> = memo(function PosPinnedTiles({ visible, suspended, onFeedback, rearm }) {
  const {
    products, triggerPinnedSlot, refreshPins,
    pendingWeight, setPendingWeight, session, language,
  } = useApp();
  const isAr = language === 'ar';
  const isOwner = session?.role === 'owner';
  const [showPinManager, setShowPinManager] = useState(false);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // DB overlay once per mount (lanes may be down — tiles stay on the cache).
  useEffect(() => { void refreshPins(); }, []);

  // Alt+1..9 → slots (fires from the scan field too, never inside a modal).
  useEffect(() => {
    const innerSuspended = suspended || pendingWeight != null || showPinManager;
    const onAlt = (e: KeyboardEvent) => {
      if (innerSuspended || !e.altKey || e.key < '1' || e.key > '9') return;
      e.preventDefault();
      const r = triggerPinnedSlot(parseInt(e.key, 10));
      if (r.success) scanBeep(); else errorBuzz();
      onFeedback(r.message, r.success);
    };
    window.addEventListener('keydown', onAlt);
    return () => window.removeEventListener('keydown', onAlt);
  }, [suspended, pendingWeight, showPinManager, triggerPinnedSlot, onFeedback]);

  const tiles = useMemo(
    () => products.filter((p) => isLive(p, today)).sort((a, b) => (a.pin_order ?? 99) - (b.pin_order ?? 99)),
    [products, today],
  );
  if (!visible || (tiles.length === 0 && !isOwner)) return null;
  return (
    <div className="mb-2.5" data-testid="pinned-tiles">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-black text-sky-300 flex items-center gap-1">
          <Pin className="w-3 h-3" /> {isAr ? '📌 مثبتات (‎#N · Alt+1..9)' : '📌 Épinglés (#N · Alt+1..9)'}
        </span>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowPinManager(true)}
            className="rounded-lg border border-sky-700/50 bg-sky-950/60 hover:bg-sky-900/60 px-2 py-0.5 text-[11px] font-bold text-sky-300 transition-all cursor-pointer"
          >
            {isAr ? 'إدارة التثبيت' : 'Gérer'}
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {tiles.map((p) => {
        const poids = p.kind === 'POIDS';
        const price = poids ? (p.price_per_kg ?? p.sell_price) : p.sell_price;
        return (
          <button
            key={`pin-${p.id}`}
            onClick={() => {
              const r = triggerPinnedSlot(p.pin_order ?? 0);
              onFeedback(r.message, r.success);
            }}
            title={poids ? `${p.name_fr} — ${price} دج/كغ (POIDS)` : p.name_fr}
            className="relative rounded-xl border border-sky-600/50 bg-sky-950/20 hover:bg-sky-950/45 p-2 text-start cursor-pointer transition-all"
            style={p.pin_color ? { borderTop: `3px solid ${p.pin_color}` } : undefined}
            data-testid={`pin-tile-${p.pin_order}`}
          >
            <span className="absolute top-1 end-1 rounded bg-sky-700/70 text-sky-100 text-[10px] font-black px-1.5 py-0.5 font-mono" dir="ltr">
              #{p.pin_order}
            </span>
            <span className="flex items-center gap-1 text-[11px] font-bold text-sky-200 pe-7">
              {p.pin_icon ? <span aria-hidden>{p.pin_icon}</span> : <Pin className="w-3 h-3 shrink-0" />}
              <span className="truncate">{p.name_fr}</span>
            </span>
            <span className="block text-xs font-mono font-bold text-sky-100 mt-1" dir="ltr">
              {formatDZD(price, false)}{poids ? '/kg' : ''}
            </span>
          </button>
        );
      })}
      </div>
      {pendingWeight && (
        <PoidsWeightModal
          product={pendingWeight.product}
          mult={pendingWeight.mult}
          onClose={() => { setPendingWeight(null); rearm(); }}
        />
      )}
      {showPinManager && (
        <PinManagerModal
          onClose={() => { setShowPinManager(false); void refreshPins(); rearm(); }}
        />
      )}
    </div>
  );
});
