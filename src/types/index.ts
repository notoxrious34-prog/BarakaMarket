export type TVARate = 0 | 9 | 19;

export type PaymentMethod = 'ESPECES' | 'CIB' | 'DAHABIYA' | 'CREDIT';

/** ADR-006-MKT: auditable shrinkage reasons (La Casse / Démarque). */
export type LossReason = 'EXPIRED' | 'BROKEN' | 'DAMAGED' | 'THEFT' | 'INTERNAL_USE' | 'AUTRE';

export interface InventoryLoss {
  id: number;
  product_id: number;
  qty_milli: number;
  reason: LossReason;
  unit_cost_ct: number;
  total_loss_ct: number;
  notes: string | null;
  created_at: string;
}

/** ADR-009-MKT: bulk catalog import row (camelCase) + batch result. */
export interface ImportProductRow {
  barcode: string;
  name: string;
  buyPriceCt: number;
  priceCt: number;
  tvaRate: 0 | 9 | 19;
  stockMilli: number;
  category: string;
  unit: 'PIECE' | 'KG' | 'LITRE';
}

export interface BatchImportResult {
  inserted: number;
  updated: number;
  failed: number;
}

/** ADR-011-MKT: supplier BL receiving (mapped to purchases/purchase_items). */
export interface SupplierDeliveryItem {
  productId: number;
  packMultiplier?: number;
  packCount: number;
  unitCostCt: number;
  totalCostCt?: number;
  updateSellPriceCt?: number;
  tvaRate?: 0 | 9 | 19;
}

export interface SupplierDeliveryReceipt {
  supplierId: number;
  invoiceRef?: string;
  items: SupplierDeliveryItem[];
  paidAmountCt: number;
  paymentMethod?: 'ESPECES' | 'VIREMENT' | 'CHEQUE';
  notes?: string;
  date?: string;
}

export interface DeliveryReceiptResult {
  purchaseId: string;
  totalCostCt: number;
  paidAmountCt: number;
  remainingDebtCt: number;
  itemsProcessed: number;
}

export interface SupplierStatement {
  supplierId: number;
  supplierName: string;
  totalPurchasedCt: number;
  totalPaidCt: number;
  outstandingCt: number;
}

/** ADR-012-MKT: customer credit ledger (Carnet de Dette) settlement. */
export interface ClientSettlementPayload {
  clientId: number;
  amountCt: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
  cashierName?: string;
  date?: string;
}

export interface ClientSettlementResult {
  settlementId: string;
  receiptNumber: string;
  clientId: number;
  clientName: string;
  clientPhone?: string;
  previousBalanceCt: number;
  paidAmountCt: number;
  timbreCt: number;
  totalCollectedCt: number;
  newBalanceCt: number;
  paymentMethod: PaymentMethod;
  cashierName?: string;
  createdAt: string;
}

export interface CreditEligibility {
  allowed: boolean;
  currentBalanceCt: number;
  maxCreditCt: number;
  projectedBalanceCt: number;
  reason?: string;
}

/** ADR-014-MKT: manager override PIN gate + void audit trail. */
export type ProtectedActionType = 'LINE_VOID' | 'CART_CLEAR' | 'MANUAL_DISCOUNT' | 'DRAWER_KICK';

export interface VoidLogEntry {
  actionType: ProtectedActionType;
  productId?: number;
  productName?: string;
  amountCt: number;
  cashierName: string;
  managerApprovedBy?: string;
  reason: string;
  sessionId?: string;
}

export interface VoidLogRecord extends VoidLogEntry {
  id: string;
  createdAt: string;
}

export interface VoidSummary {
  totalVoidCount: number;
  totalVoidAmountCt: number;
}

/** ADR-015-MKT: online backup + disaster recovery. */
export interface BackupMetadata {
  id: string;
  filename: string;
  filePath: string;
  fileSizeBytes: number;
  sha256Checksum: string;
  salesCount: number;
  productsCount: number;
  status: 'VERIFIED' | 'CORRUPT' | 'RESTORED';
  createdAt: string;
  /** Backup-Pro: human label, app + schema versions (from the manifest sidecar). */
  label?: string;
  appVersion?: string;
  schemaVersion?: number;
  /** P3 (v1.4.4): retention-exempt safety archive (pre-reset) — never pruned. */
  exempt?: boolean;
}

export interface BackupValidationReport {
  isValid: boolean;
  sha256: string;
  fileSizeBytes: number;
  salesCount: number;
  tableCount: number;
  integrityCheckResult: string;
  errors: string[];
}

export interface RestoreResult {
  success: boolean;
  quarantineBackupPath: string;
  restoredBackupPath: string;
  restoredAt: string;
}

/** ADR-013-MKT: cash session lifecycle + Z closure. */
export type CashMovementType = 'DEPOSIT' | 'WITHDRAWAL' | 'EXPENSE';

export interface CashSessionRecord {
  id: string;
  cashierName: string;
  openedAt: string;
  closedAt?: string;
  openingFloatCt: number;
  closingCountedCt?: number;
  theoreticalCashCt?: number;
  cashDiffCt?: number;
  status: 'OPEN' | 'CLOSED';
  zReportId?: string;
  notes?: string;
}

export interface CashSessionLiveStatus {
  session: CashSessionRecord;
  openingFloatCt: number;
  cashSalesCt: number;
  settlementsCashCt: number;
  depositsCt: number;
  withdrawalsCt: number;
  expensesCt: number;
  theoreticalCashCt: number;
  totalSalesCount: number;
}

export interface ZClosureResult {
  zNumber: string;
  sessionId: string;
  cashierName: string;
  periodStart: string;
  periodEnd: string;
  totalHtCt: number;
  totalTva9Ct: number;
  totalTva19Ct: number;
  totalTimbreCt: number;
  totalTtcCt: number;
  salesCount: number;
  cashSalesCt: number;
  cibSalesCt: number;
  dahabiyaSalesCt: number;
  creditSalesCt: number;
  settlementsCashCt: number;
  depositsCt: number;
  withdrawalsCt: number;
  expensesCt: number;
  openingFloatCt: number;
  theoreticalCashCt: number;
  closingCountedCt: number;
  cashDiffCt: number;
  hash: string;
  prevHash: string;
}

/** ADR-010-MKT: shelf-edge label types (canonical in core/shelf-labels). */
export type { ShelfLabelItem, A4LabelOptions } from '../core/shelf-labels.js';
/** TASK-BRK-016-MKT: reference catalog types (canonical in core/reference-search). */
export type { RefCategory, ProductTemplate } from '../core/reference-search.js';
export { REF_TO_PRODUCT_CATEGORY } from '../core/reference-search.js';

export interface StoreProfile {
  id: number;
  store_name: string;
  company_owner: string;
  rc_number: string;        // e.g. "16/00-501101"
  nif_number: string;       // 15 digits e.g. "001516012345678"
  nis_number: string;       // e.g. "198501010099"
  ai_number: string;        // Article d'Imposition e.g. "16010023451"
  address: string;
  phone: string;
  currency: string;         // 'DZD'
  receipt_footer: string;
  timbre_rate: number;      // 0.01 (1%)
  timbre_min: number;       // 10 DZD
  timbre_max: number;       // 2500 DZD
  /** Fiscal regime toggles (owner Card 3). Absent/true = tax applies (legacy). */
  tva_enabled: boolean;     // false → forfait: every sale line TVA 0 (HT=TTC)
  timbre_enabled: boolean;  // false → no Droit de Timbre even on ESPECES
}

export interface Product {
  id: number;
  barcode: string;          // EAN-13 or internal code (e.g., "613000000001", or "00040" for scale)
  name_fr: string;
  name_ar: string;
  category_id: string;
  buy_price: number;        // Prix d'Achat HT or TTC (PMP)
  sell_price: number;       // Prix de Vente TTC en DZD
  tva_rate: TVARate;        // 0, 9, 19
  stock_qty: number;        // Supports decimals for Kg/Weight
  min_stock_alert: number;
  unit: 'PIECE' | 'KG' | 'LITRE';
  is_scale_product?: boolean;
  scale_item_code?: string; // 5 digits matching scale barcode e.g. "00040"
  has_expiry_date: boolean;
  expiry_date?: string;     // YYYY-MM-DD
}

export interface Category {
  id: string;
  name_fr: string;
  name_ar: string;
  icon: string;
}

export interface SaleItem {
  product_id: number;
  barcode: string;
  name_fr: string;
  name_ar: string;
  unit_price_ttc: number;
  quantity: number;
  unit: 'PIECE' | 'KG' | 'LITRE';
  tva_rate: TVARate;
  discount_percent: number;
  total_line_ht: number;
  total_line_tva: number;
  total_line_ttc: number;
  /**
   * C2-fix (v1.4.5): unit purchase cost (HT, DZD) stamped AT SALE TIME.
   * CAMV prefers this over the live PMP so historical margins survive
   * later cost changes; absent on legacy rows (fallback: current PMP).
   */
  unit_cost_ht?: number;
  /** ADR-004-MKT colisage: base units per scanned row (>1 for packs). */
  packMultiplier?: number;
  /** ADR-004-MKT colisage: display label, e.g. 'Pack x6'. */
  packName?: string;
}

/** ADR-004-MKT: browser-lane mirror of product_barcodes (localStorage). */
export interface ProductBarcodeAlias {
  product_id: number;
  barcode: string;
  multiplier: number;
  pack_name?: string;
  price_override_ct?: number;
}

export interface TVABreakdown {
  rate: TVARate;
  base_ht: number;
  tva_amount: number;
  total_ttc: number;
}

export interface Sale {
  id: string;
  invoice_number: string;    // Legal invoice number e.g. "FACT-2026-0042"
  ticket_number: string;     // Pos ticket number e.g. "T-2026-0894"
  cashier_id: string;
  cashier_name: string;
  client_id?: number;
  client_name?: string;
  client_nif?: string;
  client_nis?: string;
  client_rc?: string;
  client_ai?: string;
  client_address?: string;
  items: SaleItem[];
  total_ht: number;
  tva_breakdown: Record<TVARate, TVABreakdown>;
  total_tva: number;
  timbre_fiscal: number;     // Droit de timbre on cash payments
  total_ttc: number;
  payment_method: PaymentMethod;
  amount_paid: number;
  amount_returned: number;
  status: 'COMPLETED' | 'CANCELLED';
  created_at: string;
  is_facture_reglementaire?: boolean;
  /** Fiscal regime the totals were computed under (owner toggles).
   * Absent = legacy row (both taxes apply). Drives the ticket regime note. */
  fiscal_regime?: { tva_enabled: boolean; timbre_enabled: boolean };
  /**
   * EXEC-DIR-2023-001 INVARIANT 2: browser-lane numbers are PROVISIONAL.
   * Authoritative fiscal numbers come from SQLite seq (FACT-YYYY-XXXXXX).
   * UI must render the NON-FISCAL banner while this flag is true.
   */
  is_provisional?: boolean;
}

export interface Client {
  id: number;
  name: string;
  phone: string;
  address: string;
  nif?: string;
  nis?: string;
  rc?: string;
  ai?: string;
  credit_balance: number;   // Current unpaid balance in DZD
  max_credit_limit: number; // Max allowed credit
  notes?: string;
}

export interface DebtSettlement {
  id: string;
  client_id: number;
  client_name: string;
  amount: number;
  payment_method: PaymentMethod;
  date: string;
  note?: string;
  /** Art.136 timbre computed on ESPECES settlements >= 50 DZD (DZD float, display). */
  timbre_fiscal?: number;
  /** Cash actually collected = amount + timbre (ESPECES) or amount (other methods). */
  total_collected?: number;
  /** Thermal quittance number: Q-YYYY-XXXXXX (monotonic, 6 digits). */
  receipt_number?: string;
  /** Fiscal regime (timbre toggle) the quittance was computed under. */
  timbre_enabled?: boolean;
}

export interface HeldCart {
  id: string;
  name: string;
  items: SaleItem[];
  client_id?: number;
  timestamp: string;
}

export interface DailyZReport {
  date: string;              // YYYY-MM-DD
  report_number: string;     // e.g. "Z-20261026-01"
  closed_at: string;
  sales_count: number;
  total_ht: number;
  total_tva: number;
  total_timbre: number;
  total_ttc: number;
  tva_0_base: number;
  tva_9_base: number;
  tva_9_amount: number;
  tva_19_base: number;
  tva_19_amount: number;
  total_especes: number;
  total_cib_dahabiya: number;
  total_credit_granted: number;
  total_credit_settled: number;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  address: string;
  nif?: string;
  nis?: string;
  rc?: string;
  ai?: string;
  balance_due: number;       // Dettes Fournisseurs (DZD owed by supermarket)
  payment_terms?: string;
  category: string;
}

export interface PurchaseItem {
  product_id: number;
  barcode: string;
  name_fr: string;
  name_ar: string;
  quantity: number;
  unit: 'PIECE' | 'KG' | 'LITRE';
  unit_buy_price_ht: number; // Nouveau prix d'achat HT
  tva_rate: TVARate;
  unit_sell_price_ttc: number; // Prix de vente TTC conseillé / fixé
  total_line_ht: number;
  total_line_ttc: number;
}

export interface PurchaseInvoice {
  id: string;
  invoice_number: string;    // e.g. "BR-2026-001" or supplier invoice reference
  supplier_id: number;
  supplier_name: string;
  items: PurchaseItem[];
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  payment_method: 'ESPECES' | 'VIREMENT' | 'CHEQUE' | 'CREDIT';
  amount_paid: number;
  amount_due: number;
  date: string;
  note?: string;
}

export interface SupplierPayment {
  id: string;
  supplier_id: number;
  supplier_name: string;
  amount: number;
  payment_method: 'ESPECES' | 'VIREMENT' | 'CHEQUE';
  reference?: string;
  date: string;
  note?: string;
}

export interface AccountingSummary {
  total_sales_ht: number;
  total_sales_ttc: number;
  total_cost_of_goods_sold: number; // CAMV: Coût d'Achat des Marchandises Vendues
  gross_margin_dzd: number;          // Marge Brute en DZD
  gross_margin_percent: number;      // Taux de marge (%)
  total_stock_value_pmp: number;     // Valeur totale du stock au PMP
  total_stock_value_retail: number;  // Valeur totale du stock au prix de vente
  total_client_receivables: number;  // Créances clients (Carnet de Dette)
  total_supplier_payables: number;   // Dettes fournisseurs
  cash_treasury: number;             // Espèces en caisse
  bank_treasury: number;             // CIB / Dahabiya
}


/** P2 (v1.4.4): shop expenses — cash outflows that justify the Z gap. */
export type ExpenseCategory =
  | 'LOYER' | 'ELEC_EAU' | 'TRANSPORT' | 'MAINTENANCE' | 'TELECOM' | 'SALAIRES' | 'AVANCES' | 'AUTRE';

export interface Expense {
  id: string;
  date: string; // ISO day YYYY-MM-DD
  category: ExpenseCategory;
  amountCt: number; // integer centimes, > 0
  method: 'ESPECES' | 'VIREMENT' | 'CHEQUE';
  note?: string;
  byUser: string;
  workerId?: number;   // set for SALAIRES / AVANCES
  tillPosted: boolean; // false when no cash session was open (hors-caisse)
  createdAt: string;
}

/** P2: workers with advance-against-salary accounts (like client ledgers). */
export interface Worker {
  id: number;
  name: string;
  phone: string;
  post: string;
  baseSalaryCt: number;
  balanceCt: number; // >0 = advances owed BY worker (receivable)
  active: boolean;
  createdAt: string;
}

export interface Advance {
  id: string;
  workerId: number;
  date: string;
  amountCt: number;
  note?: string;
  byUser: string;
  createdAt: string;
}

export interface SalarySettlement {
  id: string;
  workerId: number;
  month: string; // YYYY-MM
  baseSalaryCt: number;
  advancesCt: number;
  netPaidCt: number;
  carryCt: number; // advances exceeding salary, carried as worker debt
  byUser: string;
  createdAt: string;
}
