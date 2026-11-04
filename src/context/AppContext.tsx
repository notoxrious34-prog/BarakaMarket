import React, { createContext, useContext, useEffect, useRef, useState, useMemo } from 'react';
import { computeHwid, collectBrowserFingerprint } from '../core/licensing';
import { saveStoredLicense, restoreLicenseFromSqlite, getOrCreateMachineSeed } from '../core/license-store';
import {
  AccountingSummary,
  Advance,
  Client,
  DailyZReport,
  DebtSettlement,
  Expense,
  ExpenseCategory,
  HeldCart,
  PaymentMethod,
  Product,
  ProductBarcodeAlias,
  PurchaseInvoice,
  PurchaseItem,
  SalarySettlement,
  Sale,
  SaleItem,
  StoreProfile,
  Supplier,
  SupplierPayment,
  TVARate,
  Worker,
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
import { parseScaleBarcodeCt as parseScaleBarcode, calculateTimbreFiscalCt, calculateSaleTotalsCt, calculateLineTotalsCt, effectiveTvaRate } from '../core/fiscal.centimes';
import { advancesForMonth, settleSalaryMath, applyAdvanceToBalance, applyPaydayToBalance } from '../core/payroll';
import { probeFiscalAuthority, commitSale, commitSettlement, commitVoid, commitZClose, fetchDailyZ, factoryResetNative, createSafetySnapshot, getLoopbackToken, LOOPBACK_BASE, type AuthorityStatus, type AuthorityHeaderInput, type AuthorityItemInput } from '../core/fiscal-authority';
import { APP_VERSION } from '../core/version';
import { detectVersionShift } from '../core/version-change';
import { loginUser, listSessionUsers, changeSessionPin, auditSessionEvent, type SessionUser } from '../core/session-authority.js';
import { restoreLocalSnapshotKeys } from '../core/local-snapshot.js';
import { can, type Session } from '../core/rbac.js';
import { mintSaleKey, enqueueOutbox, replayOutbox, loadOutbox, pendingOutboxCount, removeOutboxEntry, OUTBOX_KEY, type OutboxEntry, type StorageLike } from '../core/sale-outbox';
import { parseQtyPrefix } from '../core/barcode-qty';
import { reverseReceiptLines, editReceiptLines, applyReceiptLines } from '../core/purchase-lane';
import { nextBRNumber, validateReceptionPayment, validateSupplierPayment, isValidNIF } from '../core/supplier-finance';
import { validateSettlementAmount, reverseCreditOnVoid, validateCreditLimit } from '../core/client-debt';
import { printSaleAuto, showPoleTendered } from '../core/print-lane';
import { syncCatalogToNative, upsertProductsNative } from '../core/product-authority';
import { isTauriRuntime } from '../core/fiscal-authority';
import { ean13CheckDigit } from '../core/barcode-svg';

/** localStorage-backed StorageLike for the sale outbox (never throws). */
const lsStore: StorageLike = {
  getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: queue stays in memory */ } },
};
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
  expenses: Expense[];
  workers: Worker[];
  advances: Advance[];
  salarySettlements: SalarySettlement[];
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
  /**
   * #003 (Phase A): authoritative void of a COMPLETED sale. Manager+ only,
   * reason mandatory (legal journal), native invoke first with loopback
   * fallback. Throws when the fiscal lane is unreachable — never faked.
   */
  voidSale: (saleId: string, reason: string) => Promise<void>;
  settleClientDebt: (
    clientId: number,
    amount: number,
    paymentMethod: PaymentMethod,
    note?: string
  ) => Promise<DebtSettlement>;

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
  deletePurchaseReceipt: (id: string) => void;
  updatePurchaseReceipt: (
    id: string,
    patch: { items: PurchaseItem[]; note?: string; amountPaid: number; paymentMethod: 'ESPECES' | 'VIREMENT' | 'CHEQUE' | 'CREDIT' }
  ) => void;
  settleSupplierDebt: (
    supplierId: number,
    amount: number,
    paymentMethod: 'ESPECES' | 'VIREMENT' | 'CHEQUE',
    reference?: string,
    note?: string
  ) => Promise<SupplierPayment>;
  recordExpense: (input: {
    date: string;
    category: ExpenseCategory;
    amountDzd: number;
    method: 'ESPECES' | 'VIREMENT' | 'CHEQUE';
    note?: string;
    workerId?: number;
  }) => Promise<Expense>;
  addWorker: (worker: Omit<Worker, 'id' | 'balanceCt' | 'active' | 'createdAt'>) => Worker;
  updateWorker: (id: number, worker: Partial<Worker>) => void;
  deactivateWorker: (id: number) => void;
  recordAdvance: (input: {
    workerId: number;
    date: string;
    amountDzd: number;
    note?: string;
  }) => Promise<{ advance: Advance; expense: Expense }>;
  settleSalary: (input: { workerId: number; month: string }) => Promise<SalarySettlement>;
  factoryResetDemo: (ownerPin: string) => Promise<void>;
  /**
   * P3 (v1.4.4): guarded clean-start — mandatory exempt safety snapshot,
   * audited native wipe (numbering restarts 000001), then local wipe.
   */
  factoryResetSafe: (ownerPin: string) => Promise<{ archive: string; cleared: Record<string, number> }>;
  /** P3: restore reference master-data only (products/suppliers/clients/workers) from a local snapshot. */
  restoreReferenceScope: (snapshotJson: string, scopes: { products: boolean; suppliers: boolean; clients: boolean; workers: boolean }) => Promise<string[]>;

  // Product & Store management
  addProduct: (product: Omit<Product, 'id'>) => Product;
  upsertProductsBatch: (rows: Omit<Product, 'id'>[]) => { inserted: number; updated: number; skippedDup: number; affected: Product[] };
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
  /**
   * T8 (ADR-031): authenticated session. null = nobody logged in — the UI
   * gates the whole shop behind the PIN screen while null. The fiscal lane
   * stamps cashier_id/cashier_name from this, never from constants.
   */
  session: Session | null;
  sessionLocked: boolean;
  lockNotice: string;
  sessionUsers: SessionUser[];
  lockSession: () => void;
  login: (username: string, pin: string) => Promise<
    | { ok: true }
    | { ok: false; locked: boolean; mustChange?: { userId: number; username: string } }
  >;
  logout: () => Promise<void>;
  unlockSession: (pin: string) => Promise<boolean>;
  changeOwnPin: (oldPin: string, newPin: string) => Promise<boolean>;
  refreshSessionUsers: () => Promise<void>;
  /**
   * A1 (PLAN-v1.2.0): visible outbox depth. >0 means fiscal payloads are
   * parked locally (server unreachable) — the footer badge reads this.
   */
  outboxPending: number;
  retryOutboxDrain: () => void;
  outboxFailed: boolean;
  outboxEntries: OutboxEntry[];
  refreshOutbox: () => void;
  discardOutboxEntry: (key: string) => void;
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
  EXPENSES: 'baraka_expenses_v2',
  WORKERS: 'baraka_workers_v2',
  ADVANCES: 'baraka_advances_v2',
  SALARIES: 'baraka_salary_settlements_v2',
  HELD_CARTS: 'baraka_held_carts_v2',
  STORE: 'baraka_store_v2',
  ACTIVE_DRAFT: 'baraka_active_draft_cart_v2',
  LANG: 'baraka_lang_v2',
  THEME: 'baraka_theme_v2',
  /** Owner «بداية نظيفة»: when set, initializers start empty instead of demo seed. */
  CLEAN_START: 'baraka_clean_start_v1',
  SEQ_FACT_PREFIX: 'baraka_seq_FACT_',
  SEQ_TICKET_PREFIX: 'baraka_seq_T_',
  SEQ_QUITTANCE_PREFIX: 'baraka_seq_Q_',
  BARCODES: 'baraka_product_barcodes_v1',
  /** Boot-audit: last running build, to audit silent updater installs. */
  LAST_SEEN_VERSION: 'baraka_last_seen_version_v1',
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
      if (saved) return JSON.parse(saved);
      return isCleanStart() ? [] : initialProducts;
    } catch {
      return isCleanStart() ? [] : initialProducts;
    }
  });

  // ADR-004-MKT: browser-lane alias/pack registry (SQLite product_barcodes mirror).
  const [productBarcodes, setProductBarcodes] = useState<ProductBarcodeAlias[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.BARCODES);
      if (saved) return JSON.parse(saved) as ProductBarcodeAlias[];
    } catch { /* fall through to seed */ }
    // Demo colisage: EAU LALLA 1.5L (id 5, 45 DZD) — Pack x6 label at 250 DZD.
    // Skipped on a clean start (no demo product 5 exists there).
    if (isCleanStart()) return [];
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
      if (saved) return JSON.parse(saved);
      return isCleanStart() ? [] : initialClients;
    } catch {
      return isCleanStart() ? [] : initialClients;
    }
  });

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
      if (saved) return JSON.parse(saved);
      return isCleanStart() ? [] : initialSuppliers;
    } catch {
      return isCleanStart() ? [] : initialSuppliers;
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

  const [expenses, setExpenses] = useState<Expense[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.EXPENSES);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [workers, setWorkers] = useState<Worker[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.WORKERS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [advances, setAdvances] = useState<Advance[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ADVANCES);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [salarySettlements, setSalarySettlements] = useState<SalarySettlement[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SALARIES);
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
      const base = saved ? JSON.parse(saved) : initialStoreProfile;
      // Legacy profiles predate the regime toggles — absent means the tax applies.
      return {
        ...base,
        tva_enabled: base.tva_enabled !== false,
        timbre_enabled: base.timbre_enabled !== false,
      };
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

  // A1 (PLAN-v1.2.0): visible outbox depth for the footer badge.
  const [outboxPending, setOutboxPending] = useState<number>(() => pendingOutboxCount(lsStore));
  // A1 honesty: a finished drain that leaves entries behind is a failure,
  // not silence — the badge turns red until a drain fully clears the queue.
  const [outboxFailed, setOutboxFailed] = useState<boolean>(false);
  const [outboxEntries, setOutboxEntries] = useState<OutboxEntry[]>(() => loadOutbox(lsStore));

  /** A1: single refresh point — count + rows + failed flag stay consistent. */
  const refreshOutbox = (): void => {
    const q = loadOutbox(lsStore);
    setOutboxEntries(q);
    setOutboxPending(q.length);
    // failed is sticky: once a drain leaves residue, the badge stays red
    // until the queue is empty (retry success) or the owner discards.
    if (q.length === 0) setOutboxFailed(false);
  };

  // T8 (ADR-031): authenticated session. Persisted across reloads (never the
  // PIN — only the verified identity + timestamps). Owner order 2026-11-03:
  // manual lock only — no idle timeout (lastActivityAt still refreshes on
  // fiscal commits for the audit trail).
  const SESSION_KEY = 'baraka_session_v1';
  function isCleanStart(): boolean {
  try { return localStorage.getItem(STORAGE_KEYS.CLEAN_START) === '1'; } catch { return false; }
}
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (!saved) return null;
      const s = JSON.parse(saved) as Session;
      if (typeof s.userId !== 'number' || typeof s.username !== 'string' || !s.role) return null;
      return s.lastActivityAt > 0 ? s : null;
    } catch {
      return null;
    }
  });
  const [sessionLocked, setSessionLocked] = useState(false);
  // B2: explains WHY a lock-screen unlock bounced (e.g. stale default PIN).
  const [lockNotice, setLockNotice] = useState('');
  const [sessionUsers, setSessionUsers] = useState<SessionUser[]>([]);
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;

  useEffect(() => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* private mode */ }
  }, [session]);

  const touchSession = () => {
    setSession(prev => (prev ? { ...prev, lastActivityAt: Date.now() } : prev));
  };

  // Owner order (2026-11-03): the shop locks MANUALLY ONLY (navbar lock
  // button). No idle timer — auto-lock was destroying in-progress work
  // (the takeover unmounted the POS). Security tradeoff accepted by owner:
  // a walked-away terminal stays open until the cashier locks it.
  // (Previously: 60s ticker vs SESSION_IDLE_MS — removed, do not re-add
  // without an explicit owner order.)

  const login = async (username: string, pin: string) => {
    const r = await loginUser(username.trim(), pin);
    if (!r.ok) return r;
    if (r.user.must_change_pin === 1) {
      return { ok: false as const, locked: false, mustChange: { userId: r.user.id, username: r.user.username } };
    }
    setSessionLocked(false);
    setLockNotice('');
    setSession({
      userId: r.user.id, username: r.user.username, displayName: r.user.display_name,
      role: r.user.role, loginAt: Date.now(), lastActivityAt: Date.now(),
    });
    return { ok: true as const };
  };

  const logout = async (): Promise<void> => {
    const s = sessionRef.current;
    if (s) await auditSessionEvent(s.username, 'logout');
    setSessionLocked(false);
    setSession(null);
    setSessionUsers([]);
  };

  const unlockSession = async (pin: string): Promise<boolean> => {
    const s = sessionRef.current;
    if (!s) return false;
    const r = await loginUser(s.username, pin);
    if (!r.ok) return false;
    // B2 fix: a stale lock-screen session with must_change_pin=1 used to die
    // here with a misleading "wrong code". Reset to full login instead — the
    // proven forced-change flow takes over from there.
    if (r.user.must_change_pin === 1) {
      await logout();
      setLockNotice(language === 'ar'
        ? 'الرمز الافتراضي يحتاج تغييراً — سجّل الدخول برقمك ثم اختر رمزاً جديداً'
        : 'Le code par défaut doit être changé — connectez-vous puis choisissez un code');
      return false;
    }
    setSession({ ...s, loginAt: Date.now(), lastActivityAt: Date.now() });
    setSessionLocked(false);
    await auditSessionEvent(s.username, 'session.unlock');
    return true;
  };

  const changeOwnPin = async (oldPin: string, newPin: string): Promise<boolean> => {
    const s = sessionRef.current;
    if (!s) return false;
    const ok = await changeSessionPin(s.userId, oldPin, newPin);
    if (ok) await auditSessionEvent(s.username, 'pin.change');
    return ok;
  };

  const refreshSessionUsers = async (): Promise<void> => {
    const list = await listSessionUsers();
    if (list) setSessionUsers(list);
  };

  const lockSession = (): void => {
    const s = sessionRef.current;
    if (!s) return;
    setSessionLocked(true);
    void auditSessionEvent(s.username, 'session.lock', 'manual');
  };

  // T10 (ADR-033): light transactional audit. Fiscal events land in audit_log
  // with the live operator — fire-and-forget (exe: invoke audit_log;
  // token-less browser: dropped silently, the void/Z server lanes cover it).
  const auditFiscal = (action: 'sale.commit' | 'settlement.commit' | 'sale.void', detail: string): void => {
    const actor = sessionRef.current?.username ?? 'till';
    void auditSessionEvent(actor, action, detail);
  };

  // T8: the operator stamp every fiscal AND provisional row carries.
  const cashierStamp = () => {
    const s = sessionRef.current;
    return {
      cashier_id: s ? `U-${s.userId}` : 'C-00',
      cashier_name: s ? s.displayName : '—',
    };
  };

  // Gate-02 TASK 1: probe native shell / loopback once on mount.
  useEffect(() => {
    let alive = true;
    probeFiscalAuthority().then(s => {
      if (alive) setAuthority(s);
    }).catch(() => {});
    // Boot version-shift audit: the updater can replace the binary without
    // the app's update flow running (silent auto-install) — then no
    // `update.install` row would ever exist. Any shift gets traced once.
    // Footprint check (any other baraka_ key) distinguishes a true fresh
    // install from an upgrade whose build predates this key (one-time
    // catch-up: lastSeen unknown, audited as `pre-1.4.2 → current`).
    try {
      const last = localStorage.getItem(STORAGE_KEYS.LAST_SEEN_VERSION);
      let knownInstall = false;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) || '';
          if (k.startsWith('baraka_') && k !== STORAGE_KEYS.LAST_SEEN_VERSION) { knownInstall = true; break; }
        }
      } catch { /* treat as fresh */ }
      const shift = detectVersionShift(last, APP_VERSION, knownInstall);
      if (shift === 'upgraded' || shift === 'downgraded') {
        const origin = last ?? (knownInstall ? 'pre-1.4.2' : '?');
        void auditSessionEvent('system', 'update.install', `${origin} → ${APP_VERSION} (${shift}, silent/boot-detected)`);
      }
      localStorage.setItem(STORAGE_KEYS.LAST_SEEN_VERSION, APP_VERSION);
    } catch { /* private mode */ }
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
    localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));
  }, [expenses]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WORKERS, JSON.stringify(workers));
  }, [workers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ADVANCES, JSON.stringify(advances));
  }, [advances]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SALARIES, JSON.stringify(salarySettlements));
  }, [salarySettlements]);

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
      supplierPayments,
      expenses
    );
  }, [sales, purchases, products, clients, suppliers, settlements, supplierPayments, expenses]);

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

    // B3: `N*CODE` — one scan carries the quantity (12 bottles, 3 keys).
    // Scale labels define their own qty, so the prefix only applies to
    // unit / pack / alias / fuzzy resolutions below.
    const { mult, core } = parseQtyPrefix(code);

    // ADR-003-MKT: universal scale labels PP IIIII VVVVV C (20/21/22/28/29,
    // checksum-gated). Weight -> kg qty; price -> qty back-calculated so the
    // line total reproduces the label: qtyMilli = round(priceCt*10/sell_price).
    const scaleResult = parseScaleBarcode(core);
    if (scaleResult.isScale && scaleResult.itemCode) {
      const product = products.find(
        p => p.scale_item_code === scaleResult.itemCode
          || p.scale_item_code === String(scaleResult.rawNumericCode)
          || p.barcode === core
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

    const directProduct = products.find(p => p.barcode === core);
    if (directProduct) {
      if (directProduct.is_scale_product && isHardwareScaleActive) {
        const weight = Math.round((scaleWeightGrams / 1000) * 1000) / 1000;
        addToCart(directProduct, weight);
        return {
          success: true,
          message: `${directProduct.name_fr} (${weight} kg) pesé`,
        };
      } else {
        addToCart(directProduct, mult);
        return {
          success: true,
          message: mult > 1 ? `${directProduct.name_fr} x${mult} ajouté` : `${directProduct.name_fr} ajouté`,
        };
      }
    }

    // ADR-004-MKT priority 3: alternate barcode / multipack label registry.
    // Alias (x1) resolves transparently; pack (xN) resolves with multiplier +
    // effective price (override wins, else unit x N). Chime as usual.
    const alias = productBarcodes.find(a => a.barcode === core);
    if (alias) {
      const product = products.find(p => p.id === alias.product_id);
      if (product) {
        const multiplier = alias.multiplier;
        const effectiveCt = effectivePackPriceCt(
          Math.round(product.sell_price * 100), multiplier, alias.price_override_ct ?? null,
        );
        if (multiplier > 1) {
          addToCart(product, mult, 0, {
            unitPriceTtc: effectiveCt / 100,
            packMultiplier: multiplier,
            packName: alias.pack_name ?? `Pack x${multiplier}`,
            barcode: core,
          });
          return {
            success: true,
            message: `${product.name_fr} [${alias.pack_name ?? `Pack x${multiplier}`}]${mult > 1 ? ` x${mult}` : ''} - ${(effectiveCt / 100).toFixed(2)} DZD ajouté`,
          };
        }
        addToCart(product, mult, 0, { barcode: core });
        return { success: true, message: mult > 1 ? `${product.name_fr} x${mult} ajouté` : `${product.name_fr} ajouté` };
      }
    }

    const fuzzy = products.find(
      p =>
        p.barcode.includes(core) ||
        p.name_fr.toLowerCase().includes(core.toLowerCase()) ||
        p.name_ar.includes(core)
    );
    if (fuzzy) {
      addToCart(fuzzy, mult);
      return { success: true, message: mult > 1 ? `${fuzzy.name_fr} x${mult} ajouté` : `${fuzzy.name_fr} ajouté` };
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
    // T2 (ADR-023): the browser NEVER mints fiscal numbers. Provisional rows
    // carry DRAFT refs (obviously non-fiscal, unique per finalize) until the
    // outbox drain upgrades them to authoritative FACT/T. NEVER sales.length.
    const draftRef = dateNow.getTime().toString(36).toUpperCase();
    const invoiceNumber = `DRAFT-FACT-${draftRef}`;
    const ticketNumber = `DRAFT-T-${draftRef}`;
    const returned = Math.max(0, Math.round(amountPaid - totals.total_ttc));

    const newSale: Sale = {
      id: `SALE-${Date.now()}`,
      invoice_number: invoiceNumber,
      ticket_number: ticketNumber,
      ...cashierStamp(),
      client_id: selectedClient.id,
      client_name: selectedClient.name,
      client_nif: selectedClient.nif,
      client_nis: selectedClient.nis,
      client_rc: selectedClient.rc,
      client_ai: selectedClient.ai,
      client_address: selectedClient.address,
      // C2-fix: stamp the cost actually borne, before any later PMP drift.
      items: currentCart.map(it => ({
        ...it,
        unit_cost_ht: products.find(p => p.id === it.product_id)?.buy_price ?? it.unit_cost_ht,
      })),
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
      fiscal_regime: {
        tva_enabled: storeProfile.tva_enabled !== false,
        timbre_enabled: storeProfile.timbre_enabled !== false,
      },
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
   * T1 slice B (ADR-022): drain the offline outbox whenever the fiscal lane
   * is reachable. Successful replays UPGRADE the provisional browser rows
   * (same key → authoritative FACT/T), never duplicate them.
   */
  const drainOutbox = async (): Promise<void> => {
    if (authorityRef.current !== 'FISCAL_SQLITE') return;
    try {
      const { done } = await replayOutbox(lsStore, async (e) => {
        if (e.kind === 'settlement') return commitSettlement(e.header as Parameters<typeof commitSettlement>[0]);
        return commitSale(e.header as AuthorityHeaderInput, e.items as AuthorityItemInput[]);
      });
      if (done.length === 0) return;
      const saleDone = done.filter(d => d.kind === 'sale');
      if (saleDone.length > 0) {
        setSales(prev => prev.map(s => {
          const r = saleDone.find(d => d.provisionalId === s.id);
          return r && r.auth.invoice_number && r.auth.ticket_number
            ? { ...s, id: r.auth.id, invoice_number: r.auth.invoice_number, ticket_number: r.auth.ticket_number, is_provisional: false }
            : s;
        }));
        // T10: replayed commits are fiscal events too — one audit row each.
        for (const r of saleDone) {
          if (r.auth.invoice_number) auditFiscal('sale.commit', `${r.auth.invoice_number} (replay)`);
        }
      }
      const settleDone = done.filter(d => d.kind === 'settlement');
      if (settleDone.length > 0) {
        setSettlements(prev => prev.map(s => {
          const r = settleDone.find(d => d.provisionalId === s.id);
          return r && r.auth.receipt_number
            ? { ...s, id: r.auth.id, receipt_number: r.auth.receipt_number }
            : s;
        }));
        for (const r of settleDone) {
          if (r.auth.receipt_number) auditFiscal('settlement.commit', `${r.auth.receipt_number} (replay)`);
        }
      }
    } catch { /* next drain will retry — the queue persists */ }
    finally {
      const q = loadOutbox(lsStore);
      setOutboxEntries(q);
      setOutboxPending(q.length);
      // A1 honesty: a finished drain that leaves residue is a FAILURE —
      // sticky red until the queue empties (retry success / owner discard).
      if (q.length > 0) setOutboxFailed(true);
      else setOutboxFailed(false);
    }
  };

  /** A1: manual retry from the footer badge (same lane gate as auto-drain). */
  const retryOutboxDrain = (): void => { void drainOutbox(); };

  /** A1: owner-only discard of a poison entry. Audited, never silent. */
  const discardOutboxEntry = (key: string): void => {
    const target = loadOutbox(lsStore).find(e => e.key === key);
    if (!target) return;
    auditFiscal('sale.void', `outbox discard ${target.kind} ${target.provisionalId} (key ${key.slice(0, 8)}…) by ${session?.username ?? 'till'}`);
    removeOutboxEntry(lsStore, key);
    refreshOutbox();
  };

  // Drain whenever the authority settles on the fiscal lane (probe return,
  // loopback restart, first mount with the server already up).
  useEffect(() => {
    if (authority === 'FISCAL_SQLITE') void drainOutbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authority]);

  /**
   * T4c (ADR-027): one-way catalog mirror, exe lane only, once per session.
   * Pushes the UI catalog into native SQLite so Rust sale commits decrement
   * MATCHED rows. Failure is silent by design — the sale lane NULLs unknown
   * FKs exactly as before, and the next session retries.
   */
  const nativeSyncRef = useRef(false);
  useEffect(() => {
    if (authority !== 'FISCAL_SQLITE' || nativeSyncRef.current || !isTauriRuntime()) return;
    nativeSyncRef.current = true;
    void syncCatalogToNative(products).catch(() => { nativeSyncRef.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authority]);

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
    // T8: no anonymous money. The UI gates behind the PIN screen; this guard
    // is the second wall (programmatic callers included).
    if (!sessionRef.current) throw new Error('[sale] login required');
    touchSession();
    if (currentCart.length === 0) {
      return completeSale(paymentMethod, amountPaid, isFactureReglementaire);
    }
    // Minted once per finalize — the same key follows this sale through
    // POST, failure, outbox, and replay (T1 slice B, ADR-022).
    const saleKey = mintSaleKey();
    try {
      // Regime TVA off forces rate 0 at the source: lines, tiers, payload and
      // header stay mutually consistent (server re-verifies with the same flags).
      const regime = { tva_enabled: storeProfile.tva_enabled, timbre_enabled: storeProfile.timbre_enabled };
      const ctItems = currentCart.map(it => {
        const eff = effectiveTvaRate(it.tva_rate, regime);
        const l = calculateLineTotalsCt(
          dzdToCentimes(it.unit_price_ttc), it.quantity, eff, it.discount_percent,
        );
        return {
          tva_rate: eff,
          total_line_ht_ct: l.total_line_ht_ct,
          total_line_tva_ct: l.total_line_tva_ct,
          total_line_ttc_ct: l.total_line_ttc_ct,
        };
      });
      const t = calculateSaleTotalsCt(ctItems, paymentMethod, {
        timbre_rate: storeProfile.timbre_rate,
        timbre_min: storeProfile.timbre_min,
        timbre_max: storeProfile.timbre_max,
        ...regime,
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
        tva_rate: ctItems[i].tva_rate,
        discount_bp: Math.round((it.discount_percent || 0) * 100),
        line_ht_ct: ctItems[i].total_line_ht_ct,
        line_tva_ct: ctItems[i].total_line_tva_ct,
        line_ttc_ct: ctItems[i].total_line_ttc_ct,
      }));
      const fiscalHeader: AuthorityHeaderInput = {
        client_sale_id: saleKey,
        ...cashierStamp(),
        client_id: selectedClient.id,
        client_name: selectedClient.name,
        payment_method: paymentMethod,
        fiscal_regime: {
          tva_enabled: storeProfile.tva_enabled !== false,
          timbre_enabled: storeProfile.timbre_enabled !== false,
        },
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
      };
      // Degraded lane: no commit when the fiscal lane is unreachable (rush hour first).
      const out = authorityRef.current === 'FISCAL_SQLITE'
        ? await commitSale(fiscalHeader, payloadItems)
        : null;
      if (!out) {
        // Provisional now, fiscal later: the SAME key + payload wait in the
        // outbox; the drain upgrades this row instead of duplicating it.
        const provisional = completeSale(paymentMethod, amountPaid, isFactureReglementaire);
        enqueueOutbox(lsStore, {
          key: saleKey, kind: 'sale', provisionalId: provisional.id,
          header: fiscalHeader, items: payloadItems,
          enqueuedAt: createdAt, attempts: 0,
        });
        refreshOutbox(); // A1: badge + rows now
        return provisional;
      }
      const totals = calculateSaleTotals(currentCart, paymentMethod, storeProfile);
      const authoritative: Sale = {
        id: out.id,
        invoice_number: out.invoice_number,
        ticket_number: out.ticket_number,
        ...cashierStamp(),
        client_id: selectedClient.id,
        client_name: selectedClient.name,
        // C2-fix: stamp the cost actually borne, before any later PMP drift.
        items: currentCart.map(it => ({
          ...it,
          unit_cost_ht: products.find(p => p.id === it.product_id)?.buy_price ?? it.unit_cost_ht,
        })),
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
        fiscal_regime: {
          tva_enabled: storeProfile.tva_enabled !== false,
          timbre_enabled: storeProfile.timbre_enabled !== false,
        },
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
      // T10: authoritative money leaves an audit row (actor + FACT number).
      auditFiscal('sale.commit', `${authoritative.invoice_number} · ${authoritative.total_ttc} DZD`);
      // T5 (ADR-028): Lane A auto-spool (ticket + drawer on cash) and pole
      // tendered frame — fire-and-forget; Lane B (CSS modal print) is
      // unaffected and stays the instant path.
      void printSaleAuto(authoritative, storeProfile, language === 'ar');
      void showPoleTendered(amountPaid, Math.max(0, Math.round(amountPaid - totals.total_ttc)), paymentMethod);
      // A successful commit proves the lane is alive — flush any backlog now.
      void drainOutbox();
      clearCart();
      openPrintModal(authoritative, isFactureReglementaire ? 'facture' : 'ticket');
      return authoritative;
    } catch {
      return completeSale(paymentMethod, amountPaid, isFactureReglementaire);
    }
  };

  /**
   * #003 (Phase A): authoritative void — manager+ only, reason mandatory.
   * Native invoke first, loopback fallback; throws when neither lane answers
   * (the row keeps COMPLETED rather than faking a void).
   */
  const voidSale = async (saleId: string, reason: string): Promise<void> => {
    const s = sessionRef.current;
    if (!s) throw new Error('[void] login required');
    if (!can(s.role, 'sale.void')) throw new Error('[void] manager or owner required');
    const why = reason.trim();
    if (!why) throw new Error('[void] reason is required (legal journal)');
    touchSession();
    const target = sales.find(x => x.id === saleId);
    if (!target) throw new Error('[void] sale not found');
    if (target.status !== 'COMPLETED') throw new Error('[void] only COMPLETED sales can be voided');
    const out = await commitVoid(saleId, why, s.username);
    if (!out) throw new Error('[void] fiscal lane unreachable — retry when MODE FISCAL ACTIF');
    setSales(prev => prev.map(x => (x.id === saleId ? { ...x, status: 'CANCELLED' as const } : x)));
    // D3-fix: voiding a CREDIT sale gives the debt back — the carnet must not
    // keep charging a legally cancelled sale (same rounding as the increment).
    if (target.payment_method === 'CREDIT' && target.client_id) {
      const voidedClientId = target.client_id;
      const voidedTotal = target.total_ttc;
      setClients(prev =>
        prev.map(c => (c.id === voidedClientId
          ? { ...c, credit_balance: reverseCreditOnVoid(c.credit_balance, voidedTotal) }
          : c)),
      );
    }
    auditFiscal('sale.void', `${target.invoice_number} (${why}) by ${s.username}`);
  };

  const settleClientDebt = async (
    clientId: number,
    amount: number,
    paymentMethod: PaymentMethod,
    note?: string
  ): Promise<DebtSettlement> => {
    if (!sessionRef.current) throw new Error('[settle] login required');
    touchSession();
    // D1-fix: no ghost settlements, no overpayment, no zero/negative amounts.
    // The UI caps max={balance}, but the context is the last line of defence.
    const client = clients.find(c => c.id === clientId);
    if (!client) throw new Error('[settle] client not found');
    validateSettlementAmount(amount, client.credit_balance);
    const clientName = client.name;
    const prevBalance = client.credit_balance;

    // INVARIANT 3 (Art. 136): ESPECES settlements >= 50 DZD carry timbre.
    // Principal reduces the debt; timbre is collected ON TOP for the Treasury.
    const amountCt = dzdToCentimes(amount);
    const timbreCt = calculateTimbreFiscalCt(amountCt, paymentMethod, {
      timbre_rate: storeProfile.timbre_rate,
      timbre_min: storeProfile.timbre_min,
      timbre_max: storeProfile.timbre_max,
      timbre_enabled: storeProfile.timbre_enabled,
    });
    const timbre = centimesToDzd(timbreCt);
    const totalCollected = Math.round((amount + timbre) * 100) / 100;
    const nowIso = new Date().toISOString();
    // T2b (ADR-024): one key per settlement — same key through POST, failure,
    // outbox, and replay. The server Q seq is the sole source of Q numbers.
    const settleKey = mintSaleKey();
    const fiscalInput = {
      client_id: clientId, client_name: clientName, amount_ct: amountCt,
      payment_method: paymentMethod, timbre_ct: timbreCt,
      total_collected_ct: amountCt + timbreCt,
      timbre_enabled: storeProfile.timbre_enabled !== false,
      client_settlement_key: settleKey, date: nowIso, note: note ?? null,
    };
    const out = authorityRef.current === 'FISCAL_SQLITE'
      ? await commitSettlement(fiscalInput)
      : null;
    const receipt_number = out?.receipt_number
      ?? `DRAFT-Q-${Date.now().toString(36).toUpperCase()}`;

    const settlement: DebtSettlement = {
      id: out?.id ?? `SETTLE-${Date.now()}`,
      client_id: clientId,
      client_name: clientName,
      amount: Math.round(amount * 100) / 100,
      payment_method: paymentMethod,
      date: nowIso,
      note,
      timbre_fiscal: timbre,
      total_collected: totalCollected,
      receipt_number,
      timbre_enabled: storeProfile.timbre_enabled !== false,
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
    if (!out) {
      // Provisional now, fiscal later — same T1 pattern as sales.
      enqueueOutbox(lsStore, {
        key: settleKey, kind: 'settlement', provisionalId: settlement.id,
        header: fiscalInput, items: [], enqueuedAt: nowIso, attempts: 0,
      });
      refreshOutbox(); // A1: badge + rows now
    } else {
      // T10: authoritative debt collection leaves an audit row.
      auditFiscal('settlement.commit', `${settlement.receipt_number} · ${settlement.total_collected} DZD`);
      void drainOutbox();
    }
    return settlement;
  };

  // Supplier & Goods Inbound Reception Actions
  const addSupplier = (supplierData: Omit<Supplier, 'id' | 'balance_due'>): Supplier => {
    // M7-fix: NIF is 15 digits when provided (the N1 audit note, now enforced).
    if (!isValidNIF(supplierData.nif ?? '')) throw new Error('[supplier] NIF must be exactly 15 digits');
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
    if (supplierData.nif !== undefined && !isValidNIF(supplierData.nif ?? '')) {
      throw new Error('[supplier] NIF must be exactly 15 digits');
    }
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

    // M4-fix: overpayment is refused (the remainder flows via supplier payment).
    validateReceptionPayment(totalTTC, amountPaid);
    const amountDue = Math.max(0, Math.round((totalTTC - amountPaid) * 100) / 100);

    // M1-fix: persistent per-year counter seeded from existing BRs — never
    // purchases.length-based (deletes must not recycle fiscal numbers).
    const year = new Date().getFullYear();
    const invoiceNum = nextBRNumber(lsStore, year, purchases.map(p => p.invoice_number));

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

    // 1. DIRECT STOCK & PMP RECALCULATION UPDATE IN PRODUCTS.
    // M5/M6-fix: new rows are precomputed (sequential ids, GS1 barcode) so the
    // native mirror can be synced mid-session with the exact same rows.
    const knownIds = new Set(products.map(p => p.id));
    let nextNewId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
    const created: Product[] = [];
    for (const item of items) {
      if (!knownIds.has(item.product_id)) {
        const base12 = `613${String(Math.floor(100000000 + Math.random() * 900000000))}`;
        created.push({
          id: nextNewId,
          barcode: item.barcode || (base12 + String(ean13CheckDigit(base12))),
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
        knownIds.add(item.product_id);
        // Re-point the line at the real row id (unknown ids come from drafts).
        // `items` objects are shared with the invoice lines above (same refs),
        // so the stored voucher stays consistent with the created rows.
        item.product_id = nextNewId;
        nextNewId += 1;
      }
    }
    const afterApply = applyReceiptLines([...products, ...created], items).map(p => {
      const it = items.find(i => i.product_id === p.id);
      // Reception carries the selling price forward (same as before).
      return it && it.unit_sell_price_ttc ? { ...p, sell_price: it.unit_sell_price_ttc } : p;
    });
    setProducts(afterApply);
    // M5-fix: mirror the reception mid-session (native sale lane must see it).
    void upsertProductsNative([
      ...created,
      ...afterApply.filter(p => items.some(it => it.product_id === p.id) && !created.some(c => c.id === p.id)),
    ]);

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

  /**
   * Owner order 2026-11-03: full receipt edit/delete (manager+).
   * Delete reverses stock exactly (refuses when goods were sold since) and
   * backs out the PMP; the supplier debt is reduced by the receipt's unpaid
   * remainder, floored at zero. No physical invoice renumbering — the BR
   * sequence keeps its hole (fiscal trace).
   */
  const deletePurchaseReceipt = (id: string): void => {
    const s = sessionRef.current;
    if (!s || !can(s.role, 'products.edit')) throw new Error('[receipt] manager or owner required');
    const receipt = purchases.find(p => p.id === id);
    if (!receipt) throw new Error('[receipt] not found');
    const rev = reverseReceiptLines(products, receipt.items);
    if (!rev.products) throw new Error(`[receipt] ${rev.error}`);
    setProducts(prev => prev.map(p => {
      const next = rev.products!.find(x => x.id === p.id);
      return next ? { ...p, stock_qty: next.stock_qty, buy_price: next.buy_price } : p;
    }));
    // M5-fix: mirror the reversal mid-session (no stale native stock).
    void upsertProductsNative(rev.products!.filter(p => receipt.items.some(it => it.product_id === p.id)));
    setSuppliers(prev => prev.map(x => x.id === receipt.supplier_id
      ? { ...x, balance_due: Math.round(Math.max(0, x.balance_due - receipt.amount_due) * 100) / 100 }
      : x));
    setPurchases(prev => prev.filter(p => p.id !== id));
    void auditSessionEvent(s.username, 'profile.change', `receipt ${receipt.invoice_number} deleted by ${s.username}`);
  };

  /** Edit = reverse old lines + apply new lines; invoice number kept. */
  const updatePurchaseReceipt = (
    id: string,
    patch: { items: PurchaseItem[]; note?: string; amountPaid: number; paymentMethod: 'ESPECES' | 'VIREMENT' | 'CHEQUE' | 'CREDIT' },
  ): void => {
    const s = sessionRef.current;
    if (!s || !can(s.role, 'products.edit')) throw new Error('[receipt] manager or owner required');
    const receipt = purchases.find(p => p.id === id);
    if (!receipt) throw new Error('[receipt] not found');
    if (patch.items.length === 0) throw new Error('[receipt] a receipt needs at least one line');
    const out = editReceiptLines(products, receipt.items, patch.items);
    if (!out.products) throw new Error(`[receipt] ${out.error}`);
    let totalHT = 0;
    let totalTTC = 0;
    for (const item of patch.items) {
      totalHT += item.total_line_ht;
      totalTTC += item.total_line_ttc;
    }
    totalHT = Math.round(totalHT * 100) / 100;
    totalTTC = Math.round(totalTTC * 100) / 100;
    // M4-fix: the edited receipt cannot be overpaid either.
    validateReceptionPayment(totalTTC, patch.amountPaid);
    const amountDue = Math.max(0, Math.round((totalTTC - patch.amountPaid) * 100) / 100);
    const changedIds = new Set([...receipt.items.map(i => i.product_id), ...patch.items.map(i => i.product_id)]);
    setProducts(prev => prev.map(p => {
      const next = out.products!.find(x => x.id === p.id);
      return next ? { ...p, stock_qty: next.stock_qty, buy_price: next.buy_price } : p;
    }));
    // M5-fix: mirror the edited rows mid-session.
    void upsertProductsNative(out.products!.filter(p => changedIds.has(p.id)));
    // Debt delta: remove the old unpaid remainder, add the new one.
    const debtDelta = Math.round((amountDue - receipt.amount_due) * 100) / 100;
    setSuppliers(prev => prev.map(x => x.id === receipt.supplier_id
      ? { ...x, balance_due: Math.round(Math.max(0, x.balance_due + debtDelta) * 100) / 100 }
      : x));
    setPurchases(prev => prev.map(p => p.id === id
      ? {
        ...p, items: [...patch.items], total_ht: totalHT,
        total_tva: Math.round((totalTTC - totalHT) * 100) / 100, total_ttc: totalTTC,
        payment_method: patch.paymentMethod, amount_paid: patch.amountPaid,
        amount_due: amountDue, note: patch.note,
      }
      : p));
    void auditSessionEvent(s.username, 'profile.change', `receipt ${receipt.invoice_number} edited by ${s.username}`);
  };

  /**
   * P3 (v1.4.4): the local half of any clean-start — wipes operational
   * localStorage (catalog, movements, seq counters, carts, drafts, P2
   * expenses/workers) and arms CLEAN_START so initializers reseed empty.
   * Identity (users/SQLite, store profile, license, language) is untouched.
   */
  const wipeLocalOperational = (): void => {
    const wipeExact = [
      STORAGE_KEYS.PRODUCTS, STORAGE_KEYS.CLIENTS, STORAGE_KEYS.SUPPLIERS,
      STORAGE_KEYS.SALES, STORAGE_KEYS.PURCHASES, STORAGE_KEYS.SETTLEMENTS,
      STORAGE_KEYS.SUPPLIER_PAYMENTS, STORAGE_KEYS.EXPENSES, STORAGE_KEYS.WORKERS,
      STORAGE_KEYS.ADVANCES, STORAGE_KEYS.SALARIES, STORAGE_KEYS.HELD_CARTS,
      STORAGE_KEYS.ACTIVE_DRAFT, STORAGE_KEYS.BARCODES, OUTBOX_KEY,
    ];
    for (const k of wipeExact) {
      try { localStorage.removeItem(k); } catch { /* private mode */ }
    }
    // Seq counters (FACT/T/Q/BL…) restart from zero on a clean shop.
    try {
      const seqKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('baraka_seq_'))) seqKeys.push(k);
      }
      for (const k of seqKeys) localStorage.removeItem(k);
      // Marker: initializers start empty instead of reseeding demo data.
      localStorage.setItem(STORAGE_KEYS.CLEAN_START, '1');
    } catch { /* private mode */ }
  };

  /**
   * Owner order 2026-11-03: «بداية نظيفة» — wipe all demo/operational data
   * (products, clients, suppliers, sales, purchases, settlements, payments,
   * held carts, drafts, outbox residue, seq counters, barcode aliases) and
   * keep identity: users (SQLite), store profile, license, language/theme,
   * session. Owner PIN required; refused while the outbox has residue.
   */
  const factoryResetDemo = async (ownerPin: string): Promise<void> => {
    const s = sessionRef.current;
    if (!s || s.role !== 'owner') throw new Error('[reset] owner required');
    const v = await loginUser(s.username, ownerPin);
    if (!v.ok) throw new Error('[reset] PIN incorrect');
    if (pendingOutboxCount(lsStore) > 0) {
      throw new Error('[reset] outbox has pending operations — drain first');
    }
    wipeLocalOperational();
    await auditSessionEvent(s.username, 'profile.change', 'danger: factory clean-start by owner (demo data wiped, identity kept)');
    window.location.reload();
  };

  /**
   * P3 (v1.4.4): guarded clean-start. Step 1 (mandatory): take a fresh
   * retention-exempt safety snapshot. Step 2: audited native wipe — refuses
   * without the snapshot's proof, clears the trial books, restarts numbering
   * at 000001 with a genesis audit row. Step 3: local operational wipe.
   * Nothing is touched until the snapshot lands; the native lane refuses
   * unless the archive verifies, so a half-reset cannot strand the shop.
   */
  const factoryResetSafe = async (ownerPin: string): Promise<{ archive: string; cleared: Record<string, number> }> => {
    const s = sessionRef.current;
    if (!s || s.role !== 'owner') throw new Error('[reset] owner required');
    const v = await loginUser(s.username, ownerPin);
    if (!v.ok) throw new Error('[reset] PIN incorrect');
    if (pendingOutboxCount(lsStore) > 0) {
      throw new Error('[reset] outbox has pending operations — drain first');
    }
    const snap = await createSafetySnapshot();
    const reset = await factoryResetNative(snap.filePath, s.username);
    if (!reset) throw new Error('[reset] native wipe refused — archive unverifiable on this lane');
    wipeLocalOperational();
    await auditSessionEvent(s.username, 'profile.change', `danger: guarded clean-start by owner — archive ${snap.filename}, numbering restarts 000001`);
    window.location.reload();
    return reset;
  };

  /**
   * P3 (v1.4.4): scope-limited restore — reference master-data only
   * (products incl. barcodes, suppliers, client debts, workers). Movements,
   * seq counters, carts and drafts are NEVER restored: the fiscal chain and
   * numbering stay exactly as they are. Same fail-closed envelope as a full
   * restore (checksum + drift warnings).
   */
  const restoreReferenceScope = async (
    snapshotJson: string,
    scopes: { products: boolean; suppliers: boolean; clients: boolean; workers: boolean },
  ): Promise<string[]> => {
    const s = sessionRef.current;
    if (!s || (s.role !== 'owner' && s.role !== 'manager')) throw new Error('[restore] manager required');
    const allow: string[] = [];
    if (scopes.products) allow.push(STORAGE_KEYS.PRODUCTS, STORAGE_KEYS.BARCODES);
    if (scopes.suppliers) allow.push(STORAGE_KEYS.SUPPLIERS);
    if (scopes.clients) allow.push(STORAGE_KEYS.CLIENTS);
    if (scopes.workers) allow.push(STORAGE_KEYS.WORKERS);
    if (allow.length === 0) throw new Error('[restore] select at least one reference scope');
    const res = await restoreLocalSnapshotKeys(snapshotJson, localStorage, allow);
    await auditSessionEvent(s.username, 'profile.change', `restore: reference scopes [${res.keys.join(', ')}] by ${s.username}`);
    return res.warnings.length > 0 ? [...res.keys, ...res.warnings.map(w => `warning: ${w}`)] : res.keys;
  };

  /**
   * M2/M3/M4-fix (institutional audit): settling a supplier is a guarded,
   * audited money movement. Login + expense.record required; overpayment
   * refused; ESPECES posts a till EXPENSE movement (best-effort, same policy
   * as recordExpense — recorded as tillPosted/hors-caisse, never silent).
   */
  const settleSupplierDebt = async (
    supplierId: number,
    amount: number,
    paymentMethod: 'ESPECES' | 'VIREMENT' | 'CHEQUE',
    reference?: string,
    note?: string
  ): Promise<SupplierPayment> => {
    const s = requirePerm('expense.record');
    const supplier = suppliers.find(x => x.id === supplierId);
    if (!supplier) throw new Error('[supplier-pay] supplier not found');
    // M4-fix: never pay more than the balance due.
    validateSupplierPayment(supplier.balance_due, amount);
    const rounded = Math.round(amount * 100) / 100;
    // M2-fix: cash leaves the drawer through the till lane (or honestly not).
    const tillPosted = paymentMethod === 'ESPECES'
      ? await postTillExpense(dzdToCentimes(rounded), `supplier-pay ${supplier.name}`)
      : false;
    const supplierName = supplier.name;

    const payment: SupplierPayment = {
      id: `SUP-PAY-${Date.now()}`,
      supplier_id: supplierId,
      supplier_name: supplierName,
      amount: rounded,
      payment_method: paymentMethod,
      reference,
      date: new Date().toISOString(),
      note,
    };

    setSuppliers(prev =>
      prev.map(x => {
        if (x.id === supplierId) {
          const newBalance = Math.max(0, Math.round((x.balance_due - rounded) * 100) / 100);
          return { ...x, balance_due: newBalance };
        }
        return x;
      })
    );

    setSupplierPayments(prev => [payment, ...prev]);
    await auditSessionEvent(s.username, 'supplier.pay',
      `${supplierName} ${rounded} DZD ${paymentMethod} till:${tillPosted ? 'posted' : paymentMethod === 'ESPECES' ? 'hors-caisse' : 'n/a'}`);
    return payment;
  };

  const addProduct = (productData: Omit<Product, 'id'>): Product => {
    const newId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
    const newProd: Product = { ...productData, id: newId };
    setProducts(prev => [newProd, ...prev]);
    return newProd;
  };

  /**
   * S1-fix (institutional stock audit): atomic batch UPSERT with sequential
   * ids in ONE functional update. The old per-row addProduct loop computed
   * every id from the same stale closure (duplicate ids, React key
   * collisions, wrong-row edits). In-batch barcode duplicates: last wins,
   * counted as skippedDup.
   */
  const upsertProductsBatch = (rows: Omit<Product, 'id'>[]): { inserted: number; updated: number; skippedDup: number; affected: Product[] } => {
    const seen = new Map<string, Omit<Product, 'id'>>();
    let skippedDup = 0;
    for (const r of rows) {
      if (seen.has(r.barcode)) skippedDup += 1;
      seen.set(r.barcode, r);
    }
    const uniq = [...seen.values()];
    const byBarcode = new Map(products.map(p => [p.barcode, p.id]));
    let nextId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
    const fresh: Product[] = [];
    const patches = new Map<number, Omit<Product, 'id'>>();
    let inserted = 0, updated = 0;
    for (const r of uniq) {
      const id = byBarcode.get(r.barcode);
      if (id !== undefined) { patches.set(id, r); updated += 1; }
      else { fresh.push({ ...r, id: nextId }); byBarcode.set(r.barcode, nextId); nextId += 1; inserted += 1; }
    }
    if (fresh.length > 0 || patches.size > 0) {
      setProducts(prev => {
        const patched = prev.map(p => { const u = patches.get(p.id); return u ? { ...p, ...u } : p; });
        return [...fresh, ...patched];
      });
    }
    const affected: Product[] = [...fresh];
    for (const [id, u] of patches.entries()) {
      const base = products.find(p => p.id === id);
      affected.push(base ? { ...base, ...u } : ({ ...u, id } as Product));
    }
    return { inserted, updated, skippedDup, affected };
  };

  const updateProduct = (id: number, productData: Partial<Product>) => {
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, ...productData } : p)));
  };

  const deleteProduct = (id: number) => {
    setProducts(prev => prev.filter(p => p.id !== id));
  };

  const addClient = (clientData: Omit<Client, 'id' | 'credit_balance'>): Client => {
    // D6/D7-fix: NIF optional but 15 digits when present; ceiling >= 0 (0 = unlimited).
    if (!isValidNIF(clientData.nif ?? '')) throw new Error('[client] NIF must be exactly 15 digits');
    validateCreditLimit(clientData.max_credit_limit);
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
    if (clientData.nif !== undefined && !isValidNIF(clientData.nif ?? '')) {
      throw new Error('[client] NIF must be exactly 15 digits');
    }
    if (clientData.max_credit_limit !== undefined) validateCreditLimit(clientData.max_credit_limit);
    setClients(prev => prev.map(c => (c.id === id ? { ...c, ...clientData } : c)));
  };

  const deleteClient = (id: number) => {
    setClients(prev => prev.filter(c => c.id !== id));
  };

  // P2 (v1.4.4): shop expenses leave the till and justify the Z gap.
  const EXPENSE_CATS: ExpenseCategory[] = ['LOYER', 'ELEC_EAU', 'TRANSPORT', 'MAINTENANCE', 'TELECOM', 'SALAIRES', 'AVANCES', 'AUTRE'];

  const requirePerm = (perm: 'expense.record' | 'worker.manage' | 'payroll.settle') => {
    const s = sessionRef.current;
    if (!s) throw new Error('[expense] login required');
    if (!can(s.role, perm)) throw new Error(`[${perm}] role ${s.role} not allowed`);
    touchSession();
    return s;
  };

  const postTillExpense = async (amountCt: number, reason: string): Promise<boolean> => {
    try {
      const a = await fetch(`${LOOPBACK_BASE}/api/cash/active`);
      if (!a.ok) return false;
      const live = await a.json();
      const sid = live?.session?.id as string | undefined;
      if (!sid) return false;
      // Production (Tauri) attaches the relayed loopback token; dev web has
      // none, so the movement is honestly refused and the expense stays hors-caisse.
      const token = await getLoopbackToken();
      const r = await fetch(`${LOOPBACK_BASE}/api/cash/movement`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-baraka-loopback': token } : {}),
        },
        body: JSON.stringify({ sessionId: sid, movementType: 'EXPENSE', amountCt, reason }),
      });
      return r.ok;
    } catch {
      return false;
    }
  };

  const recordExpense = async (input: {
    date: string; category: ExpenseCategory; amountDzd: number;
    method: 'ESPECES' | 'VIREMENT' | 'CHEQUE'; note?: string; workerId?: number;
  }): Promise<Expense> => {
    const s = requirePerm('expense.record');
    if (!EXPENSE_CATS.includes(input.category)) throw new Error('[expense] bad category');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('[expense] bad date');
    if (!Number.isFinite(input.amountDzd) || input.amountDzd <= 0) throw new Error('[expense] bad amount');
    // Payroll categories flow ONLY through the advance/payday lanes (ledger integrity).
    if (input.category === 'AVANCES' || input.category === 'SALAIRES') {
      throw new Error('[expense] payroll categories require recordAdvance/settleSalary');
    }
    const amountCt = dzdToCentimes(input.amountDzd);
    const id = `EXP-${Date.now().toString(36).toUpperCase()}${expenses.length.toString(36).toUpperCase()}`;
    const tillPosted = input.method === 'ESPECES'
      ? await postTillExpense(amountCt, `expense ${id} ${input.category}`)
      : false;
    const exp: Expense = {
      id, date: input.date, category: input.category, amountCt,
      method: input.method, note: input.note?.trim() || undefined,
      workerId: input.workerId, byUser: s.username, tillPosted,
      createdAt: new Date().toISOString(),
    };
    setExpenses(prev => [...prev, exp]);
    await auditSessionEvent(s.username, 'expense.add',
      `expense ${id} ${input.category} ${amountCt}ct ${input.method} till:${tillPosted ? 'posted' : 'hors-caisse'}`);
    return exp;
  };

  const addWorker = (workerData: Omit<Worker, 'id' | 'balanceCt' | 'active' | 'createdAt'>): Worker => {
    requirePerm('worker.manage');
    if (!workerData.name.trim()) throw new Error('[worker] name required');
    if (!Number.isInteger(workerData.baseSalaryCt) || workerData.baseSalaryCt < 0) throw new Error('[worker] bad salary');
    const newId = workers.length > 0 ? Math.max(...workers.map(w => w.id)) + 1 : 1;
    const w: Worker = { ...workerData, name: workerData.name.trim(), id: newId, balanceCt: 0, active: true, createdAt: new Date().toISOString() };
    setWorkers(prev => [...prev, w]);
    return w;
  };

  const updateWorker = (id: number, patch: Partial<Worker>) => {
    requirePerm('worker.manage');
    setWorkers(prev => prev.map(w => (w.id === id ? { ...w, ...patch, id: w.id, balanceCt: w.balanceCt } : w)));
  };

  const deactivateWorker = (id: number) => {
    requirePerm('worker.manage');
    setWorkers(prev => prev.map(w => (w.id === id ? { ...w, active: false } : w)));
  };

  const recordAdvance = async (input: { workerId: number; date: string; amountDzd: number; note?: string }): Promise<{ advance: Advance; expense: Expense }> => {
    const s = requirePerm('expense.record');
    const w = workers.find(x => x.id === input.workerId);
    if (!w || !w.active) throw new Error('[advance] unknown or inactive worker');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('[advance] bad date');
    if (!Number.isFinite(input.amountDzd) || input.amountDzd <= 0) throw new Error('[advance] bad amount');
    const amountCt = dzdToCentimes(input.amountDzd);
    const advance: Advance = {
      id: `ADV-${Date.now().toString(36).toUpperCase()}${advances.length.toString(36).toUpperCase()}`,
      workerId: w.id, date: input.date, amountCt,
      note: input.note?.trim() || undefined, byUser: s.username, createdAt: new Date().toISOString(),
    };
    const tillPosted = await postTillExpense(amountCt, `advance ${advance.id} worker ${w.name}`);
    const exp: Expense = {
      id: `EXP-${Date.now().toString(36).toUpperCase()}A${expenses.length.toString(36).toUpperCase()}`,
      date: input.date, category: 'AVANCES', amountCt, method: 'ESPECES',
      note: `سلفة: ${w.name}`, workerId: w.id, byUser: s.username, tillPosted,
      createdAt: new Date().toISOString(),
    };
    setAdvances(prev => [...prev, advance]);
    setWorkers(prev => prev.map(x => (x.id === w.id ? { ...x, balanceCt: applyAdvanceToBalance(x.balanceCt, amountCt) } : x)));
    setExpenses(prev => [...prev, exp]);
    await auditSessionEvent(s.username, 'advance.add',
      `advance ${advance.id} worker ${w.name} ${amountCt}ct till:${tillPosted ? 'posted' : 'hors-caisse'}`);
    return { advance, expense: exp };
  };

  const settleSalary = async (input: { workerId: number; month: string }): Promise<SalarySettlement> => {
    const s = requirePerm('payroll.settle');
    const w = workers.find(x => x.id === input.workerId);
    if (!w || !w.active) throw new Error('[salary] unknown or inactive worker');
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error('[salary] bad month');
    if (salarySettlements.some(x => x.workerId === w.id && x.month === input.month)) {
      throw new Error('[salary] month already settled (idempotent guard)');
    }
    const monthAdvancesCt = advancesForMonth(advances, w.id, input.month);
    const { netPaidCt, carryCt } = settleSalaryMath(w.baseSalaryCt, monthAdvancesCt);
    const tillPosted = netPaidCt > 0
      ? await postTillExpense(netPaidCt, `salary ${w.name} ${input.month}`)
      : false;
    const rec: SalarySettlement = {
      id: `SAL-${input.month}-${w.id}`,
      workerId: w.id, month: input.month, baseSalaryCt: w.baseSalaryCt,
      advancesCt: monthAdvancesCt, netPaidCt, carryCt, byUser: s.username,
      createdAt: new Date().toISOString(),
    };
    if (netPaidCt > 0) {
      const exp: Expense = {
        id: `EXP-${Date.now().toString(36).toUpperCase()}S${expenses.length.toString(36).toUpperCase()}`,
        date: `${input.month}-28`, category: 'SALAIRES', amountCt: netPaidCt, method: 'ESPECES',
        note: `راتب ${input.month}: ${w.name}`, workerId: w.id, byUser: s.username, tillPosted,
        createdAt: new Date().toISOString(),
      };
      setExpenses(prev => [...prev, exp]);
    }
    setSalarySettlements(prev => [...prev, rec]);
    setWorkers(prev => prev.map(x => (x.id === w.id ? { ...x, balanceCt: applyPaydayToBalance(x.balanceCt, monthAdvancesCt) } : x)));
    await auditSessionEvent(s.username, 'salary.settle',
      `salary ${rec.id} worker ${w.name} base ${w.baseSalaryCt}ct advances ${monthAdvancesCt}ct net ${netPaidCt}ct carry ${carryCt}ct`);
    return rec;
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

    // #004: ESPECES-only, timbre included (total_collected) — byte-aligned
    // with computeDayAggregates (total_collected_ct) for the close check.
    const settledTotal = todaySettlements
      .filter(st => st.payment_method === 'ESPECES')
      .reduce((sum, st) => sum + (st.total_collected ?? st.amount), 0);

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
        voidSale,
        settleClientDebt,
        expenses,
        workers,
        advances,
        salarySettlements,
        recordExpense,
        addWorker,
        updateWorker,
        deactivateWorker,
        recordAdvance,
        settleSalary,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        recordPurchaseReception,
        deletePurchaseReceipt,
        updatePurchaseReceipt,
        settleSupplierDebt,
        factoryResetDemo,
        factoryResetSafe,
        restoreReferenceScope,
        addProduct,
        upsertProductsBatch,
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
        session,
        sessionLocked,
        lockNotice,
        sessionUsers,
        lockSession,
        login,
        logout,
        unlockSession,
        changeOwnPin,
        refreshSessionUsers,
        outboxPending,
        retryOutboxDrain,
        outboxFailed,
        outboxEntries,
        refreshOutbox,
        discardOutboxEntry,
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
