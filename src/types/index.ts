export type TVARate = 0 | 9 | 19;

export type PaymentMethod = 'ESPECES' | 'CIB' | 'DAHABIYA' | 'CREDIT';

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

