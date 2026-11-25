import { useMemo } from 'react';
import { buildRapideAdd } from '../../core/rapide';
import { loadRapideMemory, getPinnedRapides, type RapideMemEntry } from '../../core/rapide-memory';
import { errorBuzz } from '../../hardware/sound';
import type { Product } from '../../types';
import type { AddToCartPack } from '../../core/cart-state';

/**
 * ADR-051 P1 — pinned rapide tiles, MKT-004 style: the store read + one-tap
 * add live in a hook so PosView stays an orchestrator (< 600 lines guard).
 * Refreshes whenever a modal closes (pin toggles / remembered sales).
 */
export function usePinnedRapides(
  modalOpen: boolean,
  addToCart: (product: Product, quantity?: number, discountPercent?: number, pack?: AddToCartPack) => void,
) {
  const tiles: RapideMemEntry[] = useMemo(() => {
    if (modalOpen) return [];
    try { return getPinnedRapides(loadRapideMemory(localStorage)); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  const addPinned = (e: RapideMemEntry) => {
    try {
      const r = buildRapideAdd({ label: e.label, priceTtcCt: e.priceTtcCt, quantity: 1, tva: e.tva, unit: e.unit });
      addToCart(r.product, r.quantity, 0, r.pack);
    } catch { errorBuzz(); }
  };

  return { tiles, addPinned };
}
