import {
  AccountingSummary,
  Client,
  DebtSettlement,
  Product,
  PurchaseInvoice,
  Sale,
  Supplier,
  SupplierPayment,
} from '../types';

/**
 * Calculates the Weighted Average Cost (PMP: Prix Moyen Pondéré)
 * According to Algerian SCF (Système Comptable Financier):
 * PMP = (Ancien Stock * Ancien PMP + Entrée Stock * Prix Achat Unitaire) / (Ancien Stock + Entrée Stock)
 */
export function calculateNewPMP(
  currentStock: number,
  currentPMP: number,
  receivedQty: number,
  newPurchasePriceHT: number
): number {
  if (receivedQty <= 0) return currentPMP;
  if (currentStock <= 0) return Math.round(newPurchasePriceHT * 100) / 100;

  const currentValuation = currentStock * currentPMP;
  const inboundValuation = receivedQty * newPurchasePriceHT;
  const totalQty = currentStock + receivedQty;

  const newPMP = (currentValuation + inboundValuation) / totalQty;
  return Math.round(newPMP * 100) / 100;
}

/**
 * Calculates complete retail accounting metrics:
 * - Gross Commercial Margin (Marge Commerciale Brute)
 * - Cost of Goods Sold (CAMV)
 * - Stock Valuation at PMP vs Retail
 * - Client receivables vs Supplier payables
 * - Real-time Cash and Bank Treasury
 */
export function calculateAccountingSummary(
  sales: Sale[],
  purchases: PurchaseInvoice[],
  products: Product[],
  clients: Client[],
  suppliers: Supplier[],
  clientSettlements: DebtSettlement[],
  supplierPayments: SupplierPayment[]
): AccountingSummary {
  // 1. Sales aggregates
  const completedSales = sales.filter(s => s.status === 'COMPLETED');
  const totalSalesHT = completedSales.reduce((sum, s) => sum + s.total_ht, 0);
  const totalSalesTTC = completedSales.reduce((sum, s) => sum + s.total_ttc, 0);

  // 2. Cost of Goods Sold (CAMV: Coût d'Achat des Marchandises Vendues)
  // Map product id to current buy price PMP
  const prodCostMap = new Map<number, number>();
  for (const p of products) {
    prodCostMap.set(p.id, p.buy_price);
  }

  let totalCAMV = 0;
  for (const sale of completedSales) {
    for (const item of sale.items) {
      const unitCost = prodCostMap.get(item.product_id) ?? (item.total_line_ht / item.quantity) * 0.75;
      totalCAMV += item.quantity * unitCost;
    }
  }

  totalCAMV = Math.round(totalCAMV * 100) / 100;
  const grossMargin = Math.round((totalSalesHT - totalCAMV) * 100) / 100;
  const grossMarginPercent =
    totalSalesHT > 0 ? Math.round((grossMargin / totalSalesHT) * 10000) / 100 : 0;

  // 3. Stock Valuations
  let totalStockValPMP = 0;
  let totalStockValRetail = 0;
  for (const p of products) {
    if (p.stock_qty > 0) {
      totalStockValPMP += p.stock_qty * p.buy_price;
      totalStockValRetail += p.stock_qty * p.sell_price;
    }
  }
  totalStockValPMP = Math.round(totalStockValPMP * 100) / 100;
  totalStockValRetail = Math.round(totalStockValRetail * 100) / 100;

  // 4. Receivables & Payables
  const totalClientReceivables = clients.reduce((sum, c) => sum + (c.credit_balance || 0), 0);
  const totalSupplierPayables = suppliers.reduce((sum, s) => sum + (s.balance_due || 0), 0);

  // 5. Treasury (Trésorerie Caisse et Banque)
  let cashTreasury = 0;
  let bankTreasury = 0;

  for (const s of completedSales) {
    if (s.payment_method === 'ESPECES') {
      cashTreasury += s.total_ttc;
    } else if (s.payment_method === 'CIB' || s.payment_method === 'DAHABIYA') {
      bankTreasury += s.total_ttc;
    }
  }

  // Add client settlements
  for (const cs of clientSettlements) {
    if (cs.payment_method === 'ESPECES') {
      cashTreasury += cs.amount;
    } else {
      bankTreasury += cs.amount;
    }
  }

  // Deduct supplier cash/bank payments
  for (const sp of supplierPayments) {
    if (sp.payment_method === 'ESPECES') {
      cashTreasury -= sp.amount;
    } else {
      bankTreasury -= sp.amount;
    }
  }

  // Deduct immediate cash/bank paid on purchase receipts
  for (const p of purchases) {
    if (p.amount_paid > 0) {
      if (p.payment_method === 'ESPECES') {
        cashTreasury -= p.amount_paid;
      } else if (p.payment_method === 'VIREMENT' || p.payment_method === 'CHEQUE') {
        bankTreasury -= p.amount_paid;
      }
    }
  }

  return {
    total_sales_ht: Math.round(totalSalesHT * 100) / 100,
    total_sales_ttc: Math.round(totalSalesTTC * 100) / 100,
    total_cost_of_goods_sold: totalCAMV,
    gross_margin_dzd: grossMargin,
    gross_margin_percent: grossMarginPercent,
    total_stock_value_pmp: totalStockValPMP,
    total_stock_value_retail: totalStockValRetail,
    total_client_receivables: Math.round(totalClientReceivables * 100) / 100,
    total_supplier_payables: Math.round(totalSupplierPayables * 100) / 100,
    cash_treasury: Math.round(cashTreasury * 100) / 100,
    bank_treasury: Math.round(bankTreasury * 100) / 100,
  };
}
