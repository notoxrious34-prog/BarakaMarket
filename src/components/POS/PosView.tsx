import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useCart } from '../../context/CartContext';
import { initialCategories } from '../../data/seedData';
import { Product, SaleItem } from '../../types';
import { calculateSaleTotals } from '../../core/cart-bridge';
import { formatDZD } from '../../core/display';
import { resolveAction } from '../../core/shortcuts';
import {
  Search,
  Barcode,
  Trash2,
  Percent,
  User,
  Sparkles,
  ShoppingBag,
  CreditCard,
  Banknote,
  BookOpen,
  ArrowRight,
  Maximize2,
  AlertCircle,
} from 'lucide-react';
import { PaymentModal } from './PaymentModal';
import { ScaleSimulationModal } from './ScaleSimulationModal';
import { QuantityModal } from './QuantityModal';
import { DiscountModal } from './DiscountModal';
import { CatalogSearchModal } from './CatalogSearchModal';
import { QuickExpenseModal } from './QuickExpenseModal';
import { PosShortcutsBar } from './PosShortcutsBar';
import { PosFiscalTotals } from './PosFiscalTotals';
import { PosCartLine } from './PosCartLine';
import { PosProductCard } from './PosProductCard';
import { useAutoFocusBarcode } from './useAutoFocusBarcode';
import { attachScannerTrap } from '../../hardware/scanner';
import { scanBeep, errorBuzz } from '../../hardware/sound';
import { getCashierPin } from '../../core/fiscal-authority';

export const PosView: React.FC = () => {
  const {
    products,
    clients,
    selectedClient,
    setSelectedClient,
    clearCart,
    holdCurrentCart,
    heldCarts,
    restoreHeldCart,
    scanBarcode,
    storeProfile,
    language,
    isHardwareScaleActive,
    setHardwareScaleActive,
    isFiscalMode,
    isTrialExpired,
    setActiveView,
  } = useApp();
  // TASK-MKT-001: cart data + mutators from the isolated CartContext.
  const {
    currentCart,
    addToCart,
    updateCartItemQty,
    updateCartItemDiscount,
    removeFromCart,
  } = useCart();

  const isAr = language === 'ar';

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  // Modals state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [qtyModalIndex, setQtyModalIndex] = useState<number | null>(null);
  const [discountModalIndex, setDiscountModalIndex] = useState<number | null>(null);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  // ADR-002-MKT: trial-expiry lockout modal (checkout hard-blocked when expired).
  const [showLicenseLock, setShowLicenseLock] = useState(false);

  /** ADR-002: expired trial routes to the activation sanctuary, not to payment. */
  const requestCheckout = () => {
    if (currentCart.length === 0) return;
    if (isTrialExpired) setShowLicenseLock(true);
    else setShowPaymentModal(true);
  };

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // TASK 6: focus trap — re-arm barcode whenever modals toggle.
  const { rearm: rearmBarcode } = useAutoFocusBarcode(barcodeInputRef, [
    showPaymentModal, showScaleModal, qtyModalIndex, discountModalIndex, showCatalogModal,
  ]);

  // Calculate live cart totals (defaulting to Cash/Espèces preview for Timbre preview)
  const cartTotals = calculateSaleTotals(currentCart, 'ESPECES', storeProfile);

  // Filter products by category and search
  const filteredProducts = products.filter(p => {
    const matchesCategory = selectedCategory === 'all' || p.category_id === selectedCategory;
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !query ||
      p.name_fr.toLowerCase().includes(query) ||
      p.name_ar.includes(query) ||
      p.barcode.includes(query);
    return matchesCategory && matchesSearch;
  });

  // Zero-Mouse Keyboard Controller (F1-F10, Space, Enter) — TASK 6 extended matrix
  // C5: key matching via the customizable registry (Settings → shortcuts);
  // behavior bodies unchanged, modes keep F-keys working from inputs.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = resolveAction(e, localStorage, 'pos');
      // Lock toggles even from inputs (cashier quick-lock)
      if (action === 'pos.lock') {
        e.preventDefault();
        setIsLocked(prev => !prev);
        return;
      }
      if (isLocked || !action) {
        // Any key unlocks except F10 handled above — require explicit F10 to avoid accidents.
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && !/^F\d+$/.test(e.key)) return;
      if (action === 'pos.search') {
        e.preventDefault();
        barcodeInputRef.current?.focus();
        barcodeInputRef.current?.select();
      } else if (action === 'pos.qty') {
        // Quantity override modal for the LAST scanned line. The old sticky
        // editingItemIndex pointed at a stale row after new scans/removals,
        // so F2/F3 silently edited the wrong line (or none at all).
        e.preventDefault();
        if (currentCart.length > 0) {
          const idx = currentCart.length - 1;
          setQtyModalIndex(idx);
        }
      } else if (action === 'pos.discount') {
        // Line remise modal (percent or fixed DZD) — same last-line rule.
        e.preventDefault();
        if (currentCart.length > 0) {
          setDiscountModalIndex(currentCart.length - 1);
        }
      } else if (action === 'pos.hold') {
        e.preventDefault();
        if (currentCart.length > 0) {
          holdCurrentCart();
        }
      } else if (action === 'pos.recall') {
        e.preventDefault();
        if (heldCarts.length > 0) {
          restoreHeldCart(heldCarts[0].id);
        }
      } else if (action === 'pos.scale') {
        e.preventDefault();
        setShowScaleModal(prev => !prev);
      } else if (action === 'pos.filter') {
        // Instant obsidian catalog search (ArrowUp/Down + Enter)
        e.preventDefault();
        setShowCatalogModal(prev => !prev);
      } else if (action === 'pos.credit' || action === 'pos.settle') {
        e.preventDefault();
        if (currentCart.length === 0) return;
        requestCheckout();
      } else if (action === 'pos.checkout') {
        // Space bar for quick checkout — suppressed on empty cart.
        e.preventDefault();
        if (currentCart.length === 0) return;
        requestCheckout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentCart, heldCarts, holdCurrentCart, restoreHeldCart, updateCartItemQty, updateCartItemDiscount, isLocked, isTrialExpired]);

  // Handle barcode scanner submission
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const res = scanBarcode(barcodeInput);
    if (res.success) scanBeep(); else errorBuzz();
    setScanFeedback({
      message: res.message,
      isError: !res.success,
    });
    setBarcodeInput('');

    setTimeout(() => {
      setScanFeedback(null);
    }, 3000);
  };

  // Gate-02 TASK 3: HID burst trap — hardware scans land in the cart even
  // when the barcode field lost focus; human typing passes through.
  useEffect(() => {
    const detach = attachScannerTrap(code => {
      const res = scanBarcode(code);
      if (res.success) scanBeep(); else errorBuzz();
      setScanFeedback({ message: res.message, isError: !res.success });
      setTimeout(() => setScanFeedback(null), 3000);
    });
    return detach;
  }, [scanBarcode]);

  return (
    <div className="flex flex-col h-[calc(100dvh-80px)] bg-[#0b0f17] overflow-hidden">
      {/* Authority banner: provisional ONLY in a loose browser without SQLite.
          In the Tauri desktop shell the fiscal state lives subtly in the
          status bar — never a conflicting full-width badge. */}
      {!isFiscalMode && (
        <div className="flex-shrink-0 px-4 py-1.5 bg-amber-950/80 border-b border-amber-500/40 text-center text-[11px] font-bold text-amber-300 tracking-wide" role="alert">
          {isAr
            ? '⚠ بيئة اختبار غير جبائية — الأرقام مؤقتة (التسلسل الأحادي من SQLite هو المرجع)'
            : '⚠ NON-FISCAL TEST ENVIRONMENT — provisional numbers (SQLite monotonic seq is authoritative)'}
        </div>
      )}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
      {/* LEFT COLUMN: Catalog, Search, Categories, Quick Tap */}
      <div className="flex-1 flex flex-col min-h-0 border-e border-[#1e293b] p-3 overflow-hidden">
        {/* Scanner & Quick Search Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-2 mb-3">
          <form
            onSubmit={handleBarcodeSubmit}
            className="flex-1 relative w-full flex items-center"
          >
            <div className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none text-emerald-400">
              <Barcode className="w-5 h-5" />
            </div>
            <input
              ref={barcodeInputRef}
              type="text"
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              placeholder={
                isAr
                  ? 'امسح الباركود أو أدخل كود الميزان (F1)... — N*code للكمية'
                  : 'Scanner code-barres ou saisir code balance (F1)... — N*code = quantité'
              }
              className="w-full bg-[#111722] border border-[#233145] focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl ps-10 pe-24 py-2.5 text-sm text-white placeholder-slate-500 shadow-inner outline-none transition-all"
              autoFocus
            />
            <button
              type="submit"
              className="absolute end-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition-colors cursor-pointer"
            >
              {isAr ? 'إدخال' : 'Valider'}
            </button>
          </form>

          {/* Quick text search (compact secondary affordance, F7) */}
          <div className="relative w-full sm:w-52 shrink-0">
            <Search className="w-4 h-4 absolute inset-y-0 start-3 my-auto text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'بحث بالاسم... (F7)' : 'Filtrer par nom... (F7)'}
              className="w-full bg-[#111722] border border-[#233145] focus:border-emerald-500 rounded-xl ps-9 pe-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
            />
          </div>

        </div>

        {/* Scan Feedback Banner */}
        {scanFeedback && (
          <div
            className={`mb-2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-1 ${
              scanFeedback.isError
                ? 'bg-rose-950/80 text-rose-300 border border-rose-800'
                : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
            }`}
          >
            <AlertCircle className="w-4 h-4" />
            <span>{scanFeedback.message}</span>
          </div>
        )}

        {/* Categories Pills */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-2 py-1 mb-2 flex-shrink-0">
          {initialCategories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-emerald-600/90 text-white shadow-md shadow-emerald-950/60 font-semibold'
                  : 'bg-[#111722] hover:bg-[#162030] text-slate-400 hover:text-slate-200 border border-[#1e293b]'
              }`}
            >
              {isAr ? cat.name_ar : cat.name_fr}
            </button>
          ))}
        </div>

        {/* Product Cards Grid — TASK-MKT-004: memoized cards. */}
        <div className="flex-1 min-h-0 overflow-y-auto pe-1 pb-1">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {filteredProducts.map(product => (
              <PosProductCard key={product.id} product={product} isAr={isAr} onAdd={addToCart} />
            ))}
          </div>
        </div>

        {/* Keyboard Shortcuts Bottom Bar (Prompt Specification) — TASK-MKT-004 island. */}
        <PosShortcutsBar isAr={isAr} />
      </div>

      {/* RIGHT COLUMN: Active Ticket / Cart, Totals & Quick Checkout */}
      <div className="w-full lg:w-[420px] flex flex-col min-h-0 bg-[#0e141f] border-s border-[#1e293b] p-3 shadow-xl">
        {/* Ticket Header: Client Selector & Order Header */}
        <div className="bg-[#111722] p-2.5 rounded-xl border border-[#1e293b] mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#162030] text-emerald-400 flex items-center justify-center shrink-0">
              <User className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <label htmlFor="pos-client-selector" className="text-[10px] text-slate-400 block">{isAr ? 'العميل المفوتر:' : 'Client:'}</label>
              <select
                id="pos-client-selector"
                value={selectedClient.id}
                onChange={e => {
                  const id = parseInt(e.target.value, 10);
                  const cl = clients.find(c => c.id === id);
                  if (cl) setSelectedClient(cl);
                }}
                className="bg-transparent text-xs font-semibold text-white outline-none w-full cursor-pointer truncate"
              >
                {clients.map(c => (
                  <option key={c.id} value={c.id} className="bg-[#111722] text-white">
                    {c.name} {c.credit_balance > 0 ? `(Crédit: ${formatDZD(c.credit_balance, false)})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {currentCart.length > 0 && (
            <button
              onClick={clearCart}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
              title={isAr ? 'إفراغ السلة' : 'Vider le panier'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Cart Items List — TASK-MKT-004: memoized lines. */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pe-1">
          {currentCart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <ShoppingBag className="w-12 h-12 stroke-[1.2] mb-3 text-slate-600" />
              <p className="text-sm font-medium text-slate-400">
                {isAr ? 'السلة فارغة' : 'Panier de vente vide'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {isAr
                  ? 'امسح بالباركود أو انقر على المنتجات لإضافتها'
                  : 'Scannez un article ou cliquez sur le catalogue'}
              </p>
            </div>
          ) : (
            currentCart.map((item, index) => (
              <PosCartLine
                key={`${item.product_id}-${index}`}
                item={item}
                index={index}
                isAr={isAr}
                onQty={updateCartItemQty}
                onRemove={removeFromCart}
              />
            ))
          )}
        </div>

        {/* Fiscal Totals & Tax Breakdown Panel (Mandatory Algerian Fiscal Engine) — TASK-MKT-004 island. */}
        <PosFiscalTotals cartTotals={cartTotals} isAr={isAr} />

        {/* ADR-007-MKT: parked-sales controls live in the top navbar + F4/F5.
            The inline Attente/Rappeler pair was the 3rd duplicate — removed. */}
        {/* P2: till expense — cashier speed lane, posts EXPENSE movement. */}
        <button
          onClick={() => setExpenseOpen(true)}
          className="mt-2 py-2 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-[#1e293b] hover:bg-[#2b3a4f] text-amber-300 border border-amber-600/30 cursor-pointer transition-all"
        >
          <span className="font-mono" dir="ltr">−</span>
          <span>{isAr ? 'مصروف صندوق' : 'Dépense caisse'}</span>
        </button>
        {/* PRIMARY CHECKOUT BUTTON — hard guard on empty cart.
            ADR-008-MKT: disabled state is theme-aware (dark: follows .dark). */}
        <button
          onClick={requestCheckout}
          disabled={currentCart.length === 0}
          className={`mt-2 py-3.5 px-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all ${
            currentCart.length === 0
              ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-300 dark:border-slate-700 cursor-not-allowed opacity-60'
              : 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-950/60 cursor-pointer'
          }`}
        >
          <Banknote className="w-5 h-5" />
          <span>{isAr ? 'إتمام الدفع والطباعة (Space)' : 'ENCAISSER & IMPRIMER (Space)'}</span>
        </button>
      </div>

      {expenseOpen && <QuickExpenseModal onClose={() => setExpenseOpen(false)} />}

      {/* Payment Modal */}
      {showPaymentModal && (
        <PaymentModal
          onClose={() => { setShowPaymentModal(false); rearmBarcode(); }}
        />
      )}

      {/* ADR-002-MKT: trial-expiry lockout — reports/stock stay open, sales stop. */}
      {showLicenseLock && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
          <div className="w-full max-w-md bg-[#0e1522] border border-amber-500/60 rounded-2xl p-6 text-center shadow-2xl">
            <p className="text-amber-300 font-bold text-lg">
              {isAr ? 'انتهت الفترة التجريبية' : "Période d'essai terminée"}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              {isAr
                ? 'انتهت الفترة التجريبية (50 عملية بيع / 14 يوماً). يرجى تفعيل البرنامج لمواصلة البيع.'
                : "Période d'essai terminée (50 ventes / 14 jours). Veuillez activer votre licence Baraka Market pour continuer les ventes."}
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => { setShowLicenseLock(false); rearmBarcode(); }}
                className="flex-1 py-2.5 px-3 bg-[#162030] hover:bg-[#1e293b] border border-[#2b3a4f] text-slate-300 rounded-xl text-sm font-semibold cursor-pointer"
              >
                {isAr ? 'لاحقاً' : 'Plus tard'}
              </button>
              <button
                onClick={() => { setShowLicenseLock(false); setActiveView('license'); }}
                className="flex-1 py-2.5 px-3 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black rounded-xl text-sm font-bold cursor-pointer"
              >
                {isAr ? 'تفعيل البرنامج' : 'Activer la licence'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scale Simulator Modal */}
      {showScaleModal && (
        <ScaleSimulationModal
          onClose={() => { setShowScaleModal(false); rearmBarcode(); }}
        />
      )}

      {/* F2 Quantity override */}
      {qtyModalIndex !== null && (
        <QuantityModal
          itemIndex={qtyModalIndex}
          onClose={() => { setQtyModalIndex(null); rearmBarcode(); }}
        />
      )}

      {/* F3 Line remise */}
      {discountModalIndex !== null && (
        <DiscountModal
          itemIndex={discountModalIndex}
          onClose={() => { setDiscountModalIndex(null); rearmBarcode(); }}
        />
      )}

      {/* F7 Catalog search */}
      {showCatalogModal && (
        <CatalogSearchModal
          onClose={() => { setShowCatalogModal(false); rearmBarcode(); }}
        />
      )}

      {/* Cashier lock overlay with 4-digit PIN (F10) */}
      {isLocked && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-8 text-center max-w-sm w-full">
            <div className="text-4xl mb-3">🔒</div>
            <h3 className="text-lg font-bold text-white">{isAr ? 'الصندوق مقفل' : 'Caisse Verrouillée'}</h3>
            <p className="text-xs text-slate-400 mt-1">{isAr ? 'أدخل رمز PIN المكوّن من 4 أرقام أو اضغط F10' : 'Code PIN à 4 chiffres ou F10'}</p>
            <form
              onSubmit={e => {
                e.preventDefault();
                if (pinInput === getCashierPin()) {
                  setIsLocked(false);
                  setPinInput('');
                  setPinError(false);
                  rearmBarcode();
                } else {
                  setPinError(true);
                }
              }}
              className="mt-4 space-y-2"
            >
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinInput}
                onChange={e => { setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(false); }}
                placeholder="••••"
                autoFocus
                className={`w-full bg-[#162030] border rounded-xl px-3 py-2.5 text-xl font-mono text-white text-center tracking-[0.5em] outline-none ${pinError ? 'border-rose-500' : 'border-[#2b3a4f] focus:border-emerald-500'}`}
                dir="ltr"
              />
              {pinError && (
                <p className="text-[11px] text-rose-400">{isAr ? 'رمز خاطئ' : 'PIN incorrect'}</p>
              )}
              <button
                type="submit"
                className="w-full px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold cursor-pointer"
              >
                {isAr ? 'فتح (Enter)' : 'Déverrouiller (Enter)'}
              </button>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
