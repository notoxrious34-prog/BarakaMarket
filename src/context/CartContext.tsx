/**
 * Baraka Market — high-frequency cart context (TASK-MKT-001).
 * Owns ONLY the live sale cart + its pure mutators so scans, qty edits and
 * discount edits re-render just the cart subscribers (POS, payment, modals,
 * navbar badge) — never the 30+ unrelated AppContext consumers.
 * The value object is memoized; mutators are useCallback-stable.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Product, SaleItem } from '../types';
import { addCartLine, removeCartLine, updateCartLineDiscount, updateCartLineQty, type AddToCartPack } from '../core/cart-state';

interface CartContextType {
  currentCart: SaleItem[];
  addToCart: (product: Product, quantity?: number, discountPercent?: number, pack?: AddToCartPack) => void;
  updateCartItemQty: (index: number, quantity: number) => void;
  updateCartItemDiscount: (index: number, discountPercent: number) => void;
  removeFromCart: (index: number) => void;
  /** Replace the whole cart (held-cart restore). */
  replaceCart: (items: SaleItem[]) => void;
  /** Empty the cart without touching anything else. */
  clearCartLines: () => void;
}

const CartContext = createContext<CartContextType | null>(null);

const ACTIVE_DRAFT_KEY = 'baraka_active_draft_cart_v2';

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentCart, setCurrentCart] = useState<SaleItem[]>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_DRAFT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as SaleItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  // Persist the crash-safe draft (moved out of AppContext with the state).
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify(currentCart));
    } catch { /* private mode: draft stays in memory */ }
  }, [currentCart]);

  const addToCart = useCallback((
    product: Product, quantity = 1, discountPercent = 0, pack?: AddToCartPack,
  ) => {
    setCurrentCart(prev => addCartLine(prev, product, quantity, discountPercent, pack));
  }, []);

  const updateCartItemQty = useCallback((index: number, quantity: number) => {
    setCurrentCart(prev => updateCartLineQty(prev, index, quantity));
  }, []);

  const updateCartItemDiscount = useCallback((index: number, discountPercent: number) => {
    setCurrentCart(prev => updateCartLineDiscount(prev, index, discountPercent));
  }, []);

  const removeFromCart = useCallback((index: number) => {
    setCurrentCart(prev => removeCartLine(prev, index));
  }, []);

  const replaceCart = useCallback((items: SaleItem[]) => {
    setCurrentCart([...items]);
  }, []);

  const clearCartLines = useCallback(() => {
    setCurrentCart([]);
  }, []);

  const value = useMemo<CartContextType>(() => ({
    currentCart,
    addToCart,
    updateCartItemQty,
    updateCartItemDiscount,
    removeFromCart,
    replaceCart,
    clearCartLines,
  }), [currentCart, addToCart, updateCartItemQty, updateCartItemDiscount, removeFromCart, replaceCart, clearCartLines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export function useCart(): CartContextType {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
