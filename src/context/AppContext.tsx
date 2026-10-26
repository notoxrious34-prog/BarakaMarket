import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import {
  AccountingSummary,
  Client,
  DailyZReport,
  DebtSettlement,
  HeldCart,
  PaymentMethod,
  Product,
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
import { calculateLineTotals, calculateSaleTotals, parseScaleBarcode } from '../utils/fiscal';
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
  activeView: 'pos' | 'products' | 'clients' | 'suppliers' | 'accounting' | 'reports' | 'license' | 'settings';
  currentPrintSale: Sale | null;
  printModalType: 'ticket' | 'facture' | null;
  language: 'ar' | 'fr';
  theme: 'dark' | 'light';
  isHardwareScaleActive: boolean;
  scaleWeightGrams: number;
  accountingSummary: AccountingSummary;

  // Actions
  setActiveView: (view: 'pos' | 'products' | 'clients' | 'suppliers' | 'accounting' | 'reports' | 'license' | 'settings') => void;
  toggleLanguage: () => void;
  toggleTheme: () => void;
  setSelectedClient: (client: Client) => void;
  addToCart: (product: Product, quantity?: number, discountPercent?: number) => void;
  updateCartItemQty: (index: number, quantity: number) => void;
  updateCartItemDiscount: (index: number, discountPercent: number) => void;
  removeFromCart: (index: number) => void;
  clearCart: () => void;
  holdCurrentCart: (name?: string) => void;
  restoreHeldCart: (heldId: string) => void;
  deleteHeldCart: (heldId: string) => void;
  scanBarcode: (barcode: string) => { success: boolean; message: string };
  completeSale: (
    paymentMethod: PaymentMethod,
    amountPaid: number,
    isFactureReglementaire?: boolean
  ) => Sale;
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
  updateStoreProfile: (profile: Partial<StoreProfile>) => void;
  openPrintModal: (sale: Sale, type: 'ticket' | 'facture') => void;
  closePrintModal: () => void;
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
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
      return saved ? JSON.parse(saved) : initialProducts;
    } catch {
      return initialProducts;
    }
  });

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
  const [activeView, setActiveView] = useState<'pos' | 'products' | 'clients' | 'suppliers' | 'accounting' | 'reports' | 'license' | 'settings'>('pos');
  const [currentPrintSale, setCurrentPrintSale] = useState<Sale | null>(null);
  const [printModalType, setPrintModalType] = useState<'ticket' | 'facture' | null>(null);

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

  const addToCart = (product: Product, quantity = 1, discountPercent = 0) => {
    setCurrentCart(prev => {
      const existingIndex = prev.findIndex(item => item.product_id === product.id);
      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const newQty = existing.quantity + quantity;
        const lineTotals = calculateLineTotals(
          product.sell_price,
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
          product.sell_price,
          quantity,
          product.tva_rate,
          discountPercent
        );
        const newItem: SaleItem = {
          product_id: product.id,
          barcode: product.barcode,
          name_fr: product.name_fr,
          name_ar: product.name_ar,
          unit_price_ttc: product.sell_price,
          quantity,
          unit: product.unit,
          tva_rate: product.tva_rate,
          discount_percent: discountPercent,
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

    const scaleResult = parseScaleBarcode(code);
    if (scaleResult.isScale && scaleResult.itemCode) {
      const product = products.find(
        p => p.scale_item_code === scaleResult.itemCode || p.barcode.includes(scaleResult.itemCode!)
      );
      if (product) {
        const qty = scaleResult.weightKg || 1;
        addToCart(product, qty);
        return {
          success: true,
          message: `${product.name_fr} - ${qty} kg ajouté via balance`,
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
    const count = sales.length + 1;
    const padded = String(count).padStart(4, '0');

    const invoiceNumber = `FACT-${year}-${padded}`;
    const ticketNumber = `T-${year}-${padded}`;
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
    };

    // Deduct stock quantities
    setProducts(prev =>
      prev.map(p => {
        const itemSold = currentCart.find(i => i.product_id === p.id);
        if (itemSold) {
          const newQty = Math.max(0, Math.round((p.stock_qty - itemSold.quantity) * 100) / 100);
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

  const settleClientDebt = (
    clientId: number,
    amount: number,
    paymentMethod: PaymentMethod,
    note?: string
  ): DebtSettlement => {
    const client = clients.find(c => c.id === clientId);
    const clientName = client ? client.name : `Client #${clientId}`;

    const settlement: DebtSettlement = {
      id: `SETTLE-${Date.now()}`,
      client_id: clientId,
      client_name: clientName,
      amount: Math.round(amount * 100) / 100,
      payment_method: paymentMethod,
      date: new Date().toISOString(),
      note,
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

  const updateStoreProfile = (profileData: Partial<StoreProfile>) => {
    setStoreProfile(prev => ({ ...prev, ...profileData }));
  };

  const openPrintModal = (sale: Sale, type: 'ticket' | 'facture') => {
    setCurrentPrintSale(sale);
    setPrintModalType(type);
  };

  const closePrintModal = () => {
    setCurrentPrintSale(null);
    setPrintModalType(null);
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
        completeSale,
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
        updateStoreProfile,
        openPrintModal,
        closePrintModal,
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
