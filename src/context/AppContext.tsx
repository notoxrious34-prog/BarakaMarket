import React, { createContext, useContext, useEffect, useRef, useState, useMemo } from 'react';
import { computeHwid, collectBrowserFingerprint } from '../core/licensing';
import { saveStoredLicense, restoreLicenseFromSqlite, getOrCreateMachineSeed } from '../core/license-store';
import {
  AccountingSummary,
  Client,
  DailyZReport,
  DebtSettlement,
  HeldCart,
  PaymentMethod,
  Product,
  ProductBarcodeAlias,
  PurchaseInvoice,
  PurchaseItem,
  Sale,
  SaleItem,
  StoreProfile,
  Supplier,
  SupplierPayment,
  TVARate,
} from '../types';
import {
  initialCategories,
  initialClients,
  initialProducts,
  initialPurchases,
  initialStoreProfile,
  initialSuppliers,
} from '../data/seedData';
import { calculateLineTotals, calculateSaleTotals, effectivePackPriceCt } from '../core/cart-bridge';
import { parseScaleBarcodeCt as parseScaleBarcode, calculateTimbreFiscalCt, calculateSaleTotalsCt, calculateLineTotalsCt } from '../core/fiscal.centimes';
import { probeFiscalAuthority, postSaleToLoopback, type AuthorityStatus } from '../core/fiscal-authority';
import { centimesToDzd, dzdToCentimes } from '../core/money';
import { calculateAccountingSummary, calculateNewPMP } from '../utils/accounting';

interface AppContextType {
  products: Product[];
  clients: Client[];
  suppliers: Supplier[];
  sales: Sale[];
  purchases: PurchaseInvoice[];
  settlements: DebtSettlement[];
  supplierPayments: SupplierPayment[];
  heldCarts: HeldCart[];
  storeProfile: StoreProfile;
  currentCart: SaleItem[];
  selectedClient: Client;
  activeView: 'pos' | 'products' | 'clients' | 'suppliers' | 'accounting' | 'reports' | 'license' | 'settings' | 'shifts';
  currentPrintSale: Sale | null;
  printModalType: 'ticket' | 'facture' | null;
  language: 'ar' | 'fr';
  theme: 'dark' | 'light';
  isHardwareScaleActive: boolean;
  scaleWeightGrams: number;
  accountingSummary: AccountingSummary;
  /**
   * Gate-02 TASK 1: dynamic authority. FISCAL_SQLITE when the native shell
   * (Tauri invoke db_status) or the local loopback WAL lane answers;
   * PROVISIONAL (amber banner) otherwise. Green badge renders while fiscal.
   */
  authority: AuthorityStatus;
  isFiscalMode: boolean;
  /** Last debt settlement with Art.136 timbre — auto-opens quittance print. */
  lastSettlementQuittance: (DebtSettlement & { prev_balance: number; new_balance: number }) | null;

  // Actions
  setActiveView: (view: 'pos' | 'products' | 'clients' | 'suppliers' | 'accounting' | 'reports' | 'license' | 'settings' | 'shifts') => void;
  toggleLanguage: () => void;
  toggleTheme: () => void;
  setSelectedClient: (client: Client) => void;
  addToCart: (product: Product, quantity?: number, discountPercent?: number, pack?: { unitPriceTtc?: number; packMultiplier?: number; packName?: string; barcode?: string }) => void;
  updateCartItemQty: (index: number, quantity: number) => void;
  updateCartItemDiscount: (index: number, discountPercent: number) => void;
  removeFromCart: (index: number) => void;
  clearCart: () => void;
  holdCurrentCart: (name?: string) => void;
  restoreHeldCart: (heldId: string) => void;
  deleteHeldCart: (heldId: string) => void;
  scanBarcode: (barcode: string) => { success: boolean; message: string };
  /** ADR-004-MKT colisage: browser-lane alias/pack labels (persisted). */
  productBarcodes: ProductBarcodeAlias[];
  addProductBarcode: (alias: ProductBarcodeAlias) => void;
  deleteProductBarcode: (barcode: string) => void;
  completeSale: (
    paymentMethod: PaymentMethod,
    amountPaid: number,
    isFactureReglementaire?: boolean
  ) => Sale;
  /**
   * Gate-02 TASK 1: authoritative checkout. In FISCAL mode POSTs the
   * centimes payload to the SQLite loopback and returns the sale stamped
   * with monotonic FACT/T numbers; falls back to provisional on failure.
   */
  completeSaleFiscal: (
    paymentMethod: PaymentMethod,
    amountPaid: number,
    isFactureReglementaire?: boolean
  ) => Promise<Sale>;
  settleClientDebt: (
    clientId: number,
    amount: number,
    paymentMethod: PaymentMethod,
    note?: string
  ) => DebtSettlement;

  // Supplier & Inbound Purchase Actions (directly updates stock & PMP)
  addSupplier: (supplier: Omit<Supplier, 'id' | 'balance_due'>) => Supplier;
  updateSupplier: (id: number, supplier: Partial<Supplier>) => void;
  deleteSupplier: (id: number) => void;
  recordPurchaseReception: (
    supplierId: number,
    items: PurchaseItem[],
    paymentMethod: 'ESPECES' | 'VIREMENT' | 'CHEQUE' | 'CREDIT',
    amountPaid: number,
    note?: string
  ) => PurchaseInvoice;
  settleSupplierDebt: (
    supplierId: number,
    amount: number,
    paymentMethod: 'ESPECES' | 'VIREMENT' | 'CHEQUE',
    reference?: string,
    note?: string
  ) => SupplierPayment;

  // Product & Store management
  addProduct: (product: Omit<Product, 'id'>) => Product;
  updateProduct: (id: number, product: Partial<Product>) => void;
  deleteProduct: (id: number) => void;
  addClient: (client: Omit<Client, 'id' | 'credit_balance'>) => Client;
  updateClient: (id: number, client: Partial<Client>) => void;
  deleteClient: (id: number) => void;
  updateStoreProfile: (profile: Partial<StoreProfile>) => void;
  /** Gate-03 TASK 4: first-run provisioning — true until the shop identity locks in. */
  needsStoreSetup: boolean;
  completeStoreSetup: (profile: { store_name: string; rc_number: string; nif_number: string; nis_number?: string; ai_number?: string; address?: string; phone?: string }) => void;
  /** Gate-03 TASK 3: license snapshot for the Navbar trial badge. */
  licenseActivated: boolean;
  trialRemaining: { sales: number; days: number };
  /** ADR-002-MKT: hard trial expiry — POS checkout blocked while true. */
  isTrialExpired: boolean;
  openPrintModal: (sale: Sale, type: 'ticket' | 'facture') => void;
  closePrintModal: () => void;
  closeSettlementQuittance: () => void;
  generateDailyZReport: () => DailyZReport;
  setHardwareScaleActive: (active: boolean) => void;
  setScaleWeightGrams: (grams: number) => void;
}

const AppContext = createContext<AppContextType | null>(null);

const STORAGE_KEYS = {
  PRODUCTS: 'baraka_products_v2',
  CLIENTS: 'baraka_clients_v2',
  SUPPLIERS: 'baraka_suppliers_v2',
  SALES: 'baraka_sales_v2',
  PURCHASES: 'baraka_purchases_v2',
  SETTLEMENTS: 'baraka_settlements_v2',
  SUPPLIER_PAYMENTS: 'baraka_supplier_payments_v2',
  HELD_CARTS: 'baraka_held_carts_v2',
  STORE: 'baraka_store_v2',
  ACTIVE_DRAFT: 'baraka_active_draft_cart_v2',
  LANG: 'baraka_lang_v2',
  THEME: 'baraka_theme_v2',
  SEQ_FACT_PREFIX: 'baraka_seq_FACT_',
  SEQ_TICKET_PREFIX: 'baraka_seq_T_',
  SEQ_QUITTANCE_PREFIX: 'baraka_seq_Q_',
  BARCODES: 'baraka_product_barcodes_v1',
};

/**
 * EXEC-DIR-2023-001 INVARIANT 2 — browser-lane monotonic sequencer.
 * Survives deletes/voids/reloads (localStorage-backed, per-year).
 * ALWAYS 6-digit zero-padded. NEVER sales.length-based.
 * These numbers are PROVISIONAL — the SQLite seq is authoritative.
 */
function nextBrowserSeq(kind: 'FACT' | 'T' | 'Q', year: number): number {
  const prefix =
    kind === 'FACT' ? STORAGE_KEYS.SEQ_FACT_PREFIX
    : kind === 'T' ? STORAGE_KEYS.SEQ_TICKET_PREFIX
    : STORAGE_KEYS.SEQ_QUITTANCE_PREFIX;
  const key = `${prefix}${year}`;
  let last = 0;
  try {
    last = parseInt(localStorage.getItem(key) ?? '0', 10) || 0;
  } catch { last = 0; }
  const next = last + 1;
  try { localStorage.setItem(key, String(next)); } catch { /* storage full — still monotonic in-memory */ }
  return next;
}

const pad6 = (n: number) => String(n).padStart(6, '0');

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
      return saved ? JSON.parse(saved) : initialProducts;
    } catch {
      return initialProducts;
    }
  });

  // ADR-004-MKT: browser-lane alias/pack registry (SQLite product_barcodes mirror).
  const [productBarcodes, setProductBarcodes] = useState<ProductBarcodeAlias[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.BARCODES);
      if (saved) return JSON.parse(saved) as ProductBarcodeAlias[];
    } catch { /* fall through to seed */ }
    // Demo colisage: EAU LALLA 1.5L (id 5, 45 DZD) — Pack x6 label at 250 DZD.
    return [{ product_id: 5, barcode: '6130000001059', multiplier: 6, pack_name: 'Pack x6', price_override_ct: 25000 }];
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.BARCODES, JSON.stringify(productBarcodes)); } catch { /* private mode */ }
  }, [productBarcodes]);

  const addProductBarcode = (alias: ProductBarcodeAlias) => {
    const code = alias.barcode.trim();
    if (!code || !Number.isInteger(alias.multiplier) || alias.multiplier < 1) return;
    setProductBarcodes(prev => {
      const rest = prev.filter(a => a.barcode !== code);
      return [...rest, { ...alias, barcode: code }];
    });
  };
  const deleteProductBarcode = (barcode: string) => {
    setProductBarcodes(prev => prev.filter(a => a.barcode !== barcode));
  };

  const [clients, setClients] = useState<Client[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CLIENTS);
      return saved ? JSON.parse(saved) : initialClients;
    } catch {
      return initialClients;
    }
  });

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
      return saved ? JSON.parse(saved) : initialSuppliers;
    } catch {
      return initialSuppliers;
    }
  });

  const [sales, setSales] = useState<Sale[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SALES);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [purchases, setPurchases] = useState<PurchaseInvoice[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PURCHASES);
      return saved ? JSON.parse(saved) : initialPurchases;
    } catch {
      return initialPurchases;
    }
  });

  const [settlements, setSettlements] = useState<DebtSettlement[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTLEMENTS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SUPPLIER_PAYMENTS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [heldCarts, setHeldCarts] = useState<HeldCart[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.HELD_CARTS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [storeProfile, setStoreProfile] = useState<StoreProfile>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.STORE);
      return saved ? JSON.parse(saved) : initialStoreProfile;
    } catch {
      return initialStoreProfile;
    }
  });

  const [currentCart, setCurrentCart] = useState<SaleItem[]>(() => {
    try {
      const draft = localStorage.getItem(STORAGE_KEYS.ACTIVE_DRAFT);
      return draft ? JSON.parse(draft) : [];
    } catch {
      return [];
    }
  });

  const [selectedClient, setSelectedClient] = useState<Client>(initialClients[0]);
  const [activeView, setActiveView] = useState<'pos' | 'products' | 'clients' | 'suppliers' | 'accounting' | 'reports' | 'license' | 'settings' | 'shifts'>('pos');
  const [currentPrintSale, setCurrentPrintSale] = useState<Sale | null>(null);
  const [printModalType, setPrintModalType] = useState<'ticket' | 'facture' | null>(null);
  const [lastSettlementQuittance, setLastSettlementQuittance] = useState<
    (DebtSettlement & { prev_balance: number; new_balance: number }) | null
  >(null);
  // Browser/localStorage lane is NEVER the fiscal authority (SQLite seq is).
  const [authority, setAuthority] = useState<AuthorityStatus>('PROVISIONAL');
  const isFiscalMode = authority === 'FISCAL_SQLITE';
  const authorityRef = useRef<AuthorityStatus>('PROVISIONAL');
  authorityRef.current = authority;

  // Gate-02 TASK 1: probe native shell / loopback once on mount.
  useEffect(() => {
    let alive = true;
    probeFiscalAuthority().then(s => {
      if (alive) setAuthority(s);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const [language, setLanguage] = useState<'ar' | 'fr'>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEYS.LANG) as 'ar' | 'fr') || 'ar';
    } catch {
      return 'ar';
    }
  });

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEYS.THEME) as 'dark' | 'light') || 'dark';
    } catch {
      return 'dark';
    }
  });

  const [isHardwareScaleActive, setHardwareScaleActive] = useState(false);
  const [scaleWeightGrams, setScaleWeightGrams] = useState(1450);

  // Synchronize direction and language attribute
  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    localStorage.setItem(STORAGE_KEYS.LANG, language);
  }, [language]);

  // Synchronize theme class on html
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  }, [theme]);

  // Persist storage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(suppliers));
  }, [suppliers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales));
  }, [sales]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PURCHASES, JSON.stringify(purchases));
  }, [purchases]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SETTLEMENTS, JSON.stringify(settlements));
  }, [settlements]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SUPPLIER_PAYMENTS, JSON.stringify(supplierPayments));
  }, [supplierPayments]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.HELD_CARTS, JSON.stringify(heldCarts));
  }, [heldCarts]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.STORE, JSON.stringify(storeProfile));
  }, [storeProfile]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_DRAFT, JSON.stringify(currentCart));
  }, [currentCart]);

  const toggleLanguage = () => {
    setLanguage(prev => (prev === 'ar' ? 'fr' : 'ar'));
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Live accounting summary
  const accountingSummary = useMemo(() => {
    return calculateAccountingSummary(
      sales,
      purchases,
      products,
      clients,
      suppliers,
      settlements,
      supplierPayments
    );
  }, [sales, purchases, products, clients, suppliers, settlements, supplierPayments]);

  const addToCart = (product: Product, quantity = 1, discountPercent = 0, pack?: { unitPriceTtc?: number; packMultiplier?: number; packName?: string; barcode?: string }) => {
    // ADR-004-MKT: pack rows carry their own unit price + multiplier; the
    // scanned pack barcode is stored so sale_items records the exact label.
    const unitPrice = pack?.unitPriceTtc ?? product.sell_price;
    const rowBarcode = pack?.barcode ?? product.barcode;
    const rowNameFr = pack?.packName ? `${product.name_fr} [${pack.packName}]` : product.name_fr;
    setCurrentCart(prev => {
      const existingIndex = prev.findIndex(item => item.product_id === product.id && item.unit_price_ttc === unitPrice && (item.packName ?? '') === (pack?.packName ?? ''));
      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const newQty = existing.quantity + quantity;
        const lineTotals = calculateLineTotals(
          unitPrice,
          newQty,
          product.tva_rate,
          discountPercent || existing.discount_percent
        );
        const updated = [...prev];
        updated[existingIndex] = {
          ...existing,
          quantity: newQty,
          discount_percent: discountPercent || existing.discount_percent,
          ...lineTotals,
        };
        return updated;
      } else {
        const lineTotals = calculateLineTotals(
          unitPrice,
          quantity,
          product.tva_rate,
          discountPercent
        );
        const newItem: SaleItem = {
          product_id: product.id,
          barcode: rowBarcode,
          name_fr: rowNameFr,
          name_ar: product.name_ar,
          unit_price_ttc: unitPrice,
          quantity,
          unit: product.unit,
          tva_rate: product.tva_rate,
          discount_percent: discountPercent,
          packMultiplier: pack?.packMultiplier,
          packName: pack?.packName,
          ...lineTotals,
        };
        return [...prev, newItem];
      }
    });
  };

  const updateCartItemQty = (index: number, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(index);
      return;
    }
    setCurrentCart(prev => {
      const item = prev[index];
      if (!item) return prev;
      const lineTotals = calculateLineTotals(
        item.unit_price_ttc,
        quantity,
        item.tva_rate,
        item.discount_percent
      );
      const updated = [...prev];
      updated[index] = {
        ...item,
        quantity,
        ...lineTotals,
      };
      return updated;
    });
  };

  const updateCartItemDiscount = (index: number, discountPercent: number) => {
    setCurrentCart(prev => {
      const item = prev[index];
      if (!item) return prev;
      const lineTotals = calculateLineTotals(
        item.unit_price_ttc,
        item.quantity,
        item.tva_rate,
        discountPercent
      );
      const updated = [...prev];
      updated[index] = {
        ...item,
        discount_percent: discountPercent,
        ...lineTotals,
      };
      return updated;
    });
  };

  const removeFromCart = (index: number) => {
    setCurrentCart(prev => prev.filter((_, i) => i !== index));
  };

  const clearCart = () => {
    setCurrentCart([]);
    setSelectedClient(initialClients[0]);
  };

  const holdCurrentCart = (name?: string) => {
    if (currentCart.length === 0) return;
    const newHeld: HeldCart = {
      id: `HOLD-${Date.now()}`,
      name: name || `Panier #${heldCarts.length + 1} - ${new Date().toLocaleTimeString()}`,
      items: [...currentCart],
      client_id: selectedClient?.id,
      timestamp: new Date().toLocaleTimeString(),
    };
    setHeldCarts(prev => [newHeld, ...prev]);
    clearCart();
  };

  const restoreHeldCart = (heldId: string) => {
    const target = heldCarts.find(h => h.id === heldId);
    if (!target) return;
    setCurrentCart(target.items);
    if (target.client_id) {
      const cl = clients.find(c => c.id === target.client_id);
      if (cl) setSelectedClient(cl);
    }
    setHeldCarts(prev => prev.filter(h => h.id !== heldId));
  };

  const deleteHeldCart = (heldId: string) => {
    setHeldCarts(prev => prev.filter(h => h.id !== heldId));
  };

  const scanBarcode = (rawInput: string): { success: boolean; message: string } => {
    const code = rawInput.trim();
    if (!code) return { success: false, message: 'Code vide' };

    // ADR-003-MKT: universal scale labels PP IIIII VVVVV C (20/21/22/28/29,
    // checksum-gated). Weight -> kg qty; price -> qty back-calculated so the
    // line total reproduces the label: qtyMilli = round(priceCt*10/sell_price).
    const scaleResult = parseScaleBarcode(code);
    if (scaleResult.isScale && scaleResult.itemCode) {
      const product = products.find(
        p => p.scale_item_code === scaleResult.itemCode
          || p.scale_item_code === String(scaleResult.rawNumericCode)
          || p.barcode === code
      );
      if (product) {
        if (scaleResult.mode === 'PRICE' && scaleResult.priceCt !== undefined) {
          const unitCt = Math.round(product.sell_price * 100);
          const qtyMilli = unitCt > 0 ? Math.round((scaleResult.priceCt * 1000) / unitCt) : 1000;
          addToCart(product, qtyMilli / 1000);
          return {
            success: true,
            message: `${product.name_fr} - ${(scaleResult.priceCt / 100).toFixed(2)} DZD (prix étiquette)`,
          };
        }
        const grams = scaleResult.weightGrams ?? 1000;
        addToCart(product, grams / 1000);
        return {
          success: true,
          message: `${product.name_fr} - ${grams} g pesé (balance)`,
        };
      }
    }

    const directProduct = products.find(p => p.barcode === code);
    if (directProduct) {
      if (directProduct.is_scale_product && isHardwareScaleActive) {
        const weight = Math.round((scaleWeightGrams / 1000) * 1000) / 1000;
        addToCart(directProduct, weight);
        return {
          success: true,
          message: `${directProduct.name_fr} (${weight} kg) pesé`,
        };
      } else {
        addToCart(directProduct, 1);
        return {
          success: true,
          message: `${directProduct.name_fr} ajouté`,
        };
      }
    }

    // ADR-004-MKT priority 3: alternate barcode / multipack label registry.
    // Alias (x1) resolves transparently; pack (xN) resolves with multiplier +
    // effective price (override wins, else unit x N). Chime as usual.
    const alias = productBarcodes.find(a => a.barcode === code);
    if (alias) {
      const product = products.find(p => p.id === alias.product_id);
      if (product) {
        const multiplier = alias.multiplier;
        const effectiveCt = effectivePackPriceCt(
          Math.round(product.sell_price * 100), multiplier, alias.price_override_ct ?? null,
        );
        if (multiplier > 1) {
          addToCart(product, 1, 0, {
            unitPriceTtc: effectiveCt / 100,
            packMultiplier: multiplier,
            packName: alias.pack_name ?? `Pack x${multiplier}`,
            barcode: code,
          });
          return {
            success: true,
            message: `${product.name_fr} [${alias.pack_name ?? `Pack x${multiplier}`}] - ${(effectiveCt / 100).toFixed(2)} DZD ajouté`,
          };
        }
        addToCart(product, 1, 0, { barcode: code });
        return { success: true, message: `${product.name_fr} ajouté` };
      }
    }

    const fuzzy = products.find(
      p =>
        p.barcode.includes(code) ||
        p.name_fr.toLowerCase().includes(code.toLowerCase()) ||
        p.name_ar.includes(code)
    );
    if (fuzzy) {
      addToCart(fuzzy, 1);
      return { success: true, message: `${fuzzy.name_fr} ajouté` };
    }

    return {
      success: false,
      message: `Produit introuvable pour le code: ${code}`,
    };
  };

  const completeSale = (
    paymentMethod: PaymentMethod,
    amountPaid: number,
    isFactureReglementaire = false
  ): Sale => {
    const totals = calculateSaleTotals(currentCart, paymentMethod, storeProfile);
    const dateNow = new Date();
    const year = dateNow.getFullYear();
    // INVARIANT 2: monotonic 6-digit provisional numbers (SQLite seq is authoritative).
    // NEVER sales.length-based. Browser lane is marked provisional + NON-FISCAL banner.
    const invoiceNumber = `FACT-${year}-${pad6(nextBrowserSeq('FACT', year))}`;
    const ticketNumber = `T-${year}-${pad6(nextBrowserSeq('T', year))}`;
    const returned = Math.max(0, Math.round(amountPaid - totals.total_ttc));

    const newSale: Sale = {
      id: `SALE-${Date.now()}`,
      invoice_number: invoiceNumber,
      ticket_number: ticketNumber,
      cashier_id: 'C-01',
      cashier_name: 'Amine',
      client_id: selectedClient.id,
      client_name: selectedClient.name,
      client_nif: selectedClient.nif,
      client_nis: selectedClient.nis,
      client_rc: selectedClient.rc,
      client_ai: selectedClient.ai,
      client_address: selectedClient.address,
      items: [...currentCart],
      total_ht: totals.total_ht,
      tva_breakdown: totals.tva_breakdown,
      total_tva: totals.total_tva,
      timbre_fiscal: totals.timbre_fiscal,
      total_ttc: totals.total_ttc,
      payment_method: paymentMethod,
      amount_paid: amountPaid,
      amount_returned: returned,
      status: 'COMPLETED',
      created_at: dateNow.toISOString(),
      is_facture_reglementaire: isFactureReglementaire,
      is_provisional: true,
    };

    // Deduct stock quantities (ADR-004-MKT: packs drain multiplier x base units)
    setProducts(prev =>
      prev.map(p => {
        const itemSold = currentCart.find(i => i.product_id === p.id);
        if (itemSold) {
          const baseUnits = itemSold.quantity * (itemSold.packMultiplier ?? 1);
          const newQty = Math.max(0, Math.round((p.stock_qty - baseUnits) * 100) / 100);
          return { ...p, stock_qty: newQty };
        }
        return p;
      })
    );

    // If Credit payment, update client's carnet de dette balance
    if (paymentMethod === 'CREDIT' && selectedClient.id) {
      setClients(prev =>
        prev.map(c => {
          if (c.id === selectedClient.id) {
            return {
              ...c,
              credit_balance: Math.round((c.credit_balance + totals.total_ttc) * 100) / 100,
            };
          }
          return c;
        })
      );
    }

    setSales(prev => [newSale, ...prev]);
    clearCart();
    openPrintModal(newSale, isFactureReglementaire ? 'facture' : 'ticket');

    return newSale;
  };

  /**
   * Gate-02 TASK 1 — authoritative checkout. Recomputes the cart through the
   * integer engine, POSTs to the SQLite loopback, and stamps the returned
   * monotonic FACT/T numbers. Falls back to provisional on any failure.
   */
  const completeSaleFiscal = async (
    paymentMethod: PaymentMethod,
    amountPaid: number,
    isFactureReglementaire = false,
  ): Promise<Sale> => {
    if (authorityRef.current !== 'FISCAL_SQLITE' || currentCart.length === 0) {
      return completeSale(paymentMethod, amountPaid, isFactureReglementaire);
    }
    try {
      const ctItems = currentCart.map(it => {
        const l = calculateLineTotalsCt(
          dzdToCentimes(it.unit_price_ttc), it.quantity, it.tva_rate, it.discount_percent,
        );
        return {
          tva_rate: it.tva_rate,
          total_line_ht_ct: l.total_line_ht_ct,
          total_line_tva_ct: l.total_line_tva_ct,
          total_line_ttc_ct: l.total_line_ttc_ct,
        };
      });
      const t = calculateSaleTotalsCt(ctItems, paymentMethod, {
        timbre_rate: storeProfile.timbre_rate,
        timbre_min: storeProfile.timbre_min,
        timbre_max: storeProfile.timbre_max,
      });
      const createdAt = new Date().toISOString();
      const payloadItems = currentCart.map((it, i) => ({
        product_id: it.product_id,
        barcode: it.barcode,
        name_fr: it.name_fr,
        name_ar: it.name_ar,
        unit_price_ct: dzdToCentimes(it.unit_price_ttc),
        // ADR-004-MKT: packs drain multiplier x base units (12 000 milli = 12 units).
        qty_milli: Math.round(it.quantity * (it.packMultiplier ?? 1) * 1000),
        unit: it.unit,
        tva_rate: it.tva_rate,
        discount_bp: Math.round((it.discount_percent || 0) * 100),
        line_ht_ct: ctItems[i].total_line_ht_ct,
        line_tva_ct: ctItems[i].total_line_tva_ct,
        line_ttc_ct: ctItems[i].total_line_ttc_ct,
      }));
      const out = await postSaleToLoopback(
        {
          cashier_id: 'C-01',
          cashier_name: 'Amine',
          client_id: selectedClient.id,
          client_name: selectedClient.name,
          payment_method: paymentMethod,
          amount_paid_ct: dzdToCentimes(amountPaid),
          amount_returned_ct: Math.max(0, dzdToCentimes(amountPaid) - t.total_ttc_ct),
          totals: {
            total_ht_ct: t.total_ht_ct,
            total_tva_ct: t.total_tva_ct,
            timbre_ct: t.timbre_ct,
            total_ttc_ct: t.total_ttc_ct,
            tva_breakdown: {
              0: { base_ht_ct: t.tva_breakdown[0].base_ht_ct, tva_amount_ct: t.tva_breakdown[0].tva_amount_ct, total_ttc_ct: t.tva_breakdown[0].total_ttc_ct },
              9: { base_ht_ct: t.tva_breakdown[9].base_ht_ct, tva_amount_ct: t.tva_breakdown[9].tva_amount_ct, total_ttc_ct: t.tva_breakdown[9].total_ttc_ct },
              19: { base_ht_ct: t.tva_breakdown[19].base_ht_ct, tva_amount_ct: t.tva_breakdown[19].tva_amount_ct, total_ttc_ct: t.tva_breakdown[19].total_ttc_ct },
            },
          },
          is_facture: isFactureReglementaire ? 1 : 0,
          created_at: createdAt,
        },
        payloadItems,
      );
      if (!out) return completeSale(paymentMethod, amountPaid, isFactureReglementaire);
      const totals = calculateSaleTotals(currentCart, paymentMethod, storeProfile);
      const authoritative: Sale = {
        id: out.id,
        invoice_number: out.invoice_number,
        ticket_number: out.ticket_number,
        cashier_id: 'C-01',
        cashier_name: 'Amine',
        client_id: selectedClient.id,
        client_name: selectedClient.name,
        items: [...currentCart],
        total_ht: totals.total_ht,
        tva_breakdown: totals.tva_breakdown,
        total_tva: totals.total_tva,
        timbre_fiscal: totals.timbre_fiscal,
        total_ttc: totals.total_ttc,
        payment_method: paymentMethod,
        amount_paid: amountPaid,
        amount_returned: Math.max(0, Math.round(amountPaid - totals.total_ttc)),
        status: 'COMPLETED',
        created_at: createdAt,
        is_facture_reglementaire: isFactureReglementaire,
        is_provisional: false,
      };
      setProducts(prev =>
        prev.map(p => {
          const itemSold = currentCart.find(i => i.product_id === p.id);
          if (itemSold) {
            const newQty = Math.max(0, Math.round((p.stock_qty - itemSold.quantity) * 100) / 100);
            return { ...p, stock_qty: newQty };
          }
          return p;
        }),
      );
      if (paymentMethod === 'CREDIT' && selectedClient.id) {
        setClients(prev =>
          prev.map(c => (c.id === selectedClient.id
            ? { ...c, credit_balance: Math.round((c.credit_balance + totals.total_ttc) * 100) / 100 }
            : c)),
        );
      }
      setSales(prev => [authoritative, ...prev]);
      clearCart();
      openPrintModal(authoritative, isFactureReglementaire ? 'facture' : 'ticket');
      return authoritative;
    } catch {
      return completeSale(paymentMethod, amountPaid, isFactureReglementaire);
    }
  };

  const settleClientDebt = (
    clientId: number,
    amount: number,
    paymentMethod: PaymentMethod,
    note?: string
  ): DebtSettlement => {
    const client = clients.find(c => c.id === clientId);
    const clientName = client ? client.name : `Client #${clientId}`;
    const prevBalance = client ? client.credit_balance : amount;

    // INVARIANT 3 (Art. 136): ESPECES settlements >= 50 DZD carry timbre.
    // Principal reduces the debt; timbre is collected ON TOP for the Treasury.
    const amountCt = dzdToCentimes(amount);
    const timbreCt = calculateTimbreFiscalCt(amountCt, paymentMethod, {
      timbre_rate: storeProfile.timbre_rate,
      timbre_min: storeProfile.timbre_min,
      timbre_max: storeProfile.timbre_max,
    });
    const timbre = centimesToDzd(timbreCt);
    const totalCollected = Math.round((amount + timbre) * 100) / 100;
    const receiptYear = new Date().getFullYear();
    const receipt_number = `Q-${receiptYear}-${pad6(nextBrowserSeq('Q', receiptYear))}`;

    const settlement: DebtSettlement = {
      id: `SETTLE-${Date.now()}`,
      client_id: clientId,
      client_name: clientName,
      amount: Math.round(amount * 100) / 100,
      payment_method: paymentMethod,
      date: new Date().toISOString(),
      note,
      timbre_fiscal: timbre,
      total_collected: totalCollected,
      receipt_number,
    };

    setClients(prev =>
      prev.map(c => {
        if (c.id === clientId) {
          const newBalance = Math.max(0, Math.round((c.credit_balance - amount) * 100) / 100);
          return { ...c, credit_balance: newBalance };
        }
        return c;
      })
    );

    setSettlements(prev => [settlement, ...prev]);
    const newBalance = Math.max(0, Math.round((prevBalance - amount) * 100) / 100);
    setLastSettlementQuittance({ ...settlement, prev_balance: prevBalance, new_balance: newBalance });
    return settlement;
  };

  // Supplier & Goods Inbound Reception Actions
  const addSupplier = (supplierData: Omit<Supplier, 'id' | 'balance_due'>): Supplier => {
    const newId = suppliers.length > 0 ? Math.max(...suppliers.map(s => s.id)) + 1 : 1;
    const newSupplier: Supplier = {
      ...supplierData,
      id: newId,
      balance_due: 0,
    };
    setSuppliers(prev => [newSupplier, ...prev]);
    return newSupplier;
  };

  const updateSupplier = (id: number, supplierData: Partial<Supplier>) => {
    setSuppliers(prev => prev.map(s => (s.id === id ? { ...s, ...supplierData } : s)));
  };

  const deleteSupplier = (id: number) => {
    setSuppliers(prev => prev.filter(s => s.id !== id));
  };

  /**
   * CRITICAL FEATURE: Receiving goods from a supplier.
   * DIRECTLY updates stock & recalculates PMP (Prix Moyen Pondéré) for all products in the invoice!
   */
  const recordPurchaseReception = (
    supplierId: number,
    items: PurchaseItem[],
    paymentMethod: 'ESPECES' | 'VIREMENT' | 'CHEQUE' | 'CREDIT',
    amountPaid: number,
    note?: string
  ): PurchaseInvoice => {
    const supplier = suppliers.find(s => s.id === supplierId);
    const supplierName = supplier ? supplier.name : `Fournisseur #${supplierId}`;

    let totalHT = 0;
    let totalTTC = 0;
    for (const item of items) {
      totalHT += item.total_line_ht;
      totalTTC += item.total_line_ttc;
    }
    totalHT = Math.round(totalHT * 100) / 100;
    totalTTC = Math.round(totalTTC * 100) / 100;

    const amountDue = Math.max(0, Math.round((totalTTC - amountPaid) * 100) / 100);

    const year = new Date().getFullYear();
    const count = purchases.length + 1;
    const invoiceNum = `BR-${year}-${String(count).padStart(4, '0')}`;

    const newInvoice: PurchaseInvoice = {
      id: `PURCHASE-${Date.now()}`,
      invoice_number: invoiceNum,
      supplier_id: supplierId,
      supplier_name: supplierName,
      items: [...items],
      total_ht: totalHT,
      total_tva: Math.round((totalTTC - totalHT) * 100) / 100,
      total_ttc: totalTTC,
      payment_method: paymentMethod,
      amount_paid: amountPaid,
      amount_due: amountDue,
      date: new Date().toISOString(),
      note,
    };

    // 1. DIRECT STOCK & PMP RECALCULATION UPDATE IN PRODUCTS
    setProducts(prevProducts => {
      const updated = [...prevProducts];

      for (const item of items) {
        const prodIndex = updated.findIndex(p => p.id === item.product_id);
        if (prodIndex >= 0) {
          const currentProd = updated[prodIndex];
          const newQty = Math.round((currentProd.stock_qty + item.quantity) * 100) / 100;

          // Compute new PMP
          const newPMP = calculateNewPMP(
            currentProd.stock_qty,
            currentProd.buy_price,
            item.quantity,
            item.unit_buy_price_ht
          );

          updated[prodIndex] = {
            ...currentProd,
            stock_qty: newQty,
            buy_price: newPMP,
            sell_price: item.unit_sell_price_ttc || currentProd.sell_price,
          };
        } else {
          // New product received from supplier
          const newId = updated.length > 0 ? Math.max(...updated.map(p => p.id)) + 1 : 1;
          updated.push({
            id: newId,
            barcode: item.barcode || `613${Math.floor(1000000000 + Math.random() * 9000000000)}`,
            name_fr: item.name_fr,
            name_ar: item.name_ar || item.name_fr,
            category_id: 'epicerie',
            buy_price: item.unit_buy_price_ht,
            sell_price: item.unit_sell_price_ttc,
            tva_rate: item.tva_rate,
            stock_qty: item.quantity,
            min_stock_alert: 10,
            unit: item.unit,
            has_expiry_date: false,
          });
        }
      }

      return updated;
    });

    // 2. UPDATE SUPPLIER DEBT IF CREDIT OR PARTIAL PAYMENT
    if (amountDue > 0) {
      setSuppliers(prev =>
        prev.map(s => {
          if (s.id === supplierId) {
            return {
              ...s,
              balance_due: Math.round((s.balance_due + amountDue) * 100) / 100,
            };
          }
          return s;
        })
      );
    }

    setPurchases(prev => [newInvoice, ...prev]);
    return newInvoice;
  };

  const settleSupplierDebt = (
    supplierId: number,
    amount: number,
    paymentMethod: 'ESPECES' | 'VIREMENT' | 'CHEQUE',
    reference?: string,
    note?: string
  ): SupplierPayment => {
    const supplier = suppliers.find(s => s.id === supplierId);
    const supplierName = supplier ? supplier.name : `Fournisseur #${supplierId}`;

    const payment: SupplierPayment = {
      id: `SUP-PAY-${Date.now()}`,
      supplier_id: supplierId,
      supplier_name: supplierName,
      amount: Math.round(amount * 100) / 100,
      payment_method: paymentMethod,
      reference,
      date: new Date().toISOString(),
      note,
    };

    setSuppliers(prev =>
      prev.map(s => {
        if (s.id === supplierId) {
          const newBalance = Math.max(0, Math.round((s.balance_due - amount) * 100) / 100);
          return { ...s, balance_due: newBalance };
        }
        return s;
      })
    );

    setSupplierPayments(prev => [payment, ...prev]);
    return payment;
  };

  const addProduct = (productData: Omit<Product, 'id'>): Product => {
    const newId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
    const newProd: Product = { ...productData, id: newId };
    setProducts(prev => [newProd, ...prev]);
    return newProd;
  };

  const updateProduct = (id: number, productData: Partial<Product>) => {
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, ...productData } : p)));
  };

  const deleteProduct = (id: number) => {
    setProducts(prev => prev.filter(p => p.id !== id));
  };

  const addClient = (clientData: Omit<Client, 'id' | 'credit_balance'>): Client => {
    const newId = clients.length > 0 ? Math.max(...clients.map(c => c.id)) + 1 : 1;
    const newClient: Client = {
      ...clientData,
      id: newId,
      credit_balance: 0,
    };
    setClients(prev => [...prev, newClient]);
    return newClient;
  };

  const updateClient = (id: number, clientData: Partial<Client>) => {
    setClients(prev => prev.map(c => (c.id === id ? { ...c, ...clientData } : c)));
  };

  const deleteClient = (id: number) => {
    setClients(prev => prev.filter(c => c.id !== id));
  };

  const updateStoreProfile = (profileData: Partial<StoreProfile>) => {
    setStoreProfile(prev => ({ ...prev, ...profileData }));
  };

  // Gate-03 TASK 4: fresh installs (no setup flag) must provision identity first.
  const [needsStoreSetup, setNeedsStoreSetup] = useState<boolean>(() => {
    try {
      return localStorage.getItem('baraka_store_setup_done') !== '1';
    } catch {
      return false;
    }
  });
  const completeStoreSetup = (profile: { store_name: string; rc_number: string; nif_number: string; nis_number?: string; ai_number?: string; address?: string; phone?: string }) => {
    setStoreProfile(prev => ({ ...prev, ...profile }));
    try { localStorage.setItem('baraka_store_setup_done', '1'); } catch { /* private mode */ }
    setNeedsStoreSetup(false);
  };

  // Gate-03 TASK 3: trial badge data (recomputed from stored license + sales).
  // ADR-002-MKT: licenseRev re-fires the snapshot after SQLite-mirror restore.
  const [licenseRev, setLicenseRev] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem('baraka_license_v1')) return;
        const hwid = computeHwid(collectBrowserFingerprint(getOrCreateMachineSeed()));
        const rec = await restoreLicenseFromSqlite(hwid);
        if (!cancelled && rec) {
          saveStoredLicense(rec);
          setLicenseRev(r => r + 1);
        }
      } catch { /* offline lane */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const licenseSnapshot = useMemo(() => {
    try {
      const raw = localStorage.getItem('baraka_license_v1');
      if (raw && (JSON.parse(raw) as { status?: string }).status === 'ACTIVATED') {
        return { activated: true, sales: Number.POSITIVE_INFINITY, days: Number.POSITIVE_INFINITY };
      }
    } catch { /* fall through to trial */ }
    const completed = sales.filter(s => s.status === 'COMPLETED').length;
    let days = 14;
    try {
      const inst = parseInt(localStorage.getItem('baraka_installed_at') ?? '', 10);
      if (Number.isFinite(inst)) days = Math.max(0, 14 - Math.floor((Date.now() - inst) / 86400000));
    } catch { /* keep default */ }
    return { activated: false, sales: Math.max(0, 50 - completed), days };
  }, [sales, licenseRev]);

  /** ADR-002-MKT: trial checkout lockout — BOTH budgets exhausted, no license. */
  const isTrialExpired = !licenseSnapshot.activated
    && licenseSnapshot.sales <= 0
    && licenseSnapshot.days <= 0;

  const openPrintModal = (sale: Sale, type: 'ticket' | 'facture') => {
    setCurrentPrintSale(sale);
    setPrintModalType(type);
  };

  const closePrintModal = () => {
    setCurrentPrintSale(null);
    setPrintModalType(null);
  };

  const closeSettlementQuittance = () => {
    setLastSettlementQuittance(null);
  };

  const generateDailyZReport = (): DailyZReport => {
    const today = new Date().toISOString().split('T')[0];
    const todaySales = sales.filter(s => s.created_at.startsWith(today) && s.status === 'COMPLETED');
    const todaySettlements = settlements.filter(st => st.date.startsWith(today));

    let totalHT = 0;
    let totalTVA = 0;
    let totalTimbre = 0;
    let totalTTC = 0;

    let tva0Base = 0;
    let tva9Base = 0;
    let tva9Amount = 0;
    let tva19Base = 0;
    let tva19Amount = 0;

    let totalEspeces = 0;
    let totalCIB = 0;
    let totalCreditNew = 0;

    for (const sale of todaySales) {
      totalHT += sale.total_ht;
      totalTVA += sale.total_tva;
      totalTimbre += sale.timbre_fiscal;
      totalTTC += sale.total_ttc;

      if (sale.tva_breakdown) {
        if (sale.tva_breakdown[0]) tva0Base += sale.tva_breakdown[0].base_ht;
        if (sale.tva_breakdown[9]) {
          tva9Base += sale.tva_breakdown[9].base_ht;
          tva9Amount += sale.tva_breakdown[9].tva_amount;
        }
        if (sale.tva_breakdown[19]) {
          tva19Base += sale.tva_breakdown[19].base_ht;
          tva19Amount += sale.tva_breakdown[19].tva_amount;
        }
      }

      if (sale.payment_method === 'ESPECES') {
        totalEspeces += sale.total_ttc;
      } else if (sale.payment_method === 'CIB' || sale.payment_method === 'DAHABIYA') {
        totalCIB += sale.total_ttc;
      } else if (sale.payment_method === 'CREDIT') {
        totalCreditNew += sale.total_ttc;
      }
    }

    const settledTotal = todaySettlements.reduce((sum, st) => sum + st.amount, 0);

    const report: DailyZReport = {
      date: today,
      report_number: `Z-${today.replace(/-/g, '')}-01`,
      closed_at: new Date().toLocaleTimeString(),
      sales_count: todaySales.length,
      total_ht: Math.round(totalHT * 100) / 100,
      total_tva: Math.round(totalTVA * 100) / 100,
      total_timbre: totalTimbre,
      total_ttc: Math.round(totalTTC * 100) / 100,
      tva_0_base: Math.round(tva0Base * 100) / 100,
      tva_9_base: Math.round(tva9Base * 100) / 100,
      tva_9_amount: Math.round(tva9Amount * 100) / 100,
      tva_19_base: Math.round(tva19Base * 100) / 100,
      tva_19_amount: Math.round(tva19Amount * 100) / 100,
      total_especes: Math.round(totalEspeces * 100) / 100,
      total_cib_dahabiya: Math.round(totalCIB * 100) / 100,
      total_credit_granted: Math.round(totalCreditNew * 100) / 100,
      total_credit_settled: Math.round(settledTotal * 100) / 100,
    };

    return report;
  };

  return (
    <AppContext.Provider
      value={{
        products,
        clients,
        suppliers,
        sales,
        purchases,
        settlements,
        supplierPayments,
        heldCarts,
        storeProfile,
        currentCart,
        selectedClient,
        activeView,
        currentPrintSale,
        printModalType,
        language,
        theme,
        isHardwareScaleActive,
        scaleWeightGrams,
        accountingSummary,
        isFiscalMode,
        authority,
        lastSettlementQuittance,
        setActiveView,
        toggleLanguage,
        toggleTheme,
        setSelectedClient,
        addToCart,
        updateCartItemQty,
        updateCartItemDiscount,
        removeFromCart,
        clearCart,
        holdCurrentCart,
        restoreHeldCart,
        deleteHeldCart,
        scanBarcode,
        productBarcodes,
        addProductBarcode,
        deleteProductBarcode,
        completeSale,
        completeSaleFiscal,
        settleClientDebt,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        recordPurchaseReception,
        settleSupplierDebt,
        addProduct,
        updateProduct,
        deleteProduct,
        addClient,
        updateClient,
        deleteClient,
        updateStoreProfile,
        needsStoreSetup,
        completeStoreSetup,
        licenseActivated: licenseSnapshot.activated,
        trialRemaining: { sales: licenseSnapshot.sales, days: licenseSnapshot.days },
        isTrialExpired,
        openPrintModal,
        closePrintModal,
        closeSettlementQuittance,
        generateDailyZReport,
        setHardwareScaleActive,
        setScaleWeightGrams,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
