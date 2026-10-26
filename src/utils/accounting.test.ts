import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNewPMP, calculateAccountingSummary } from './accounting';
import { Client, Product, PurchaseInvoice, Sale, Supplier } from '../types';

test('calculateNewPMP computes accurate weighted average cost according to Algerian SCF', () => {
  // Case 1: 10 units @ 100 DZD + 10 units @ 120 DZD => (1000 + 1200) / 20 = 110 DZD
  const pmp1 = calculateNewPMP(10, 100, 10, 120);
  assert.equal(pmp1, 110);

  // Case 2: 48 units of Lait Condensé @ 145 DZD, receiving 52 units @ 155 DZD
  // (48 * 145 + 52 * 155) / 100 = (6960 + 8060) / 100 = 15020 / 100 = 150.20 DZD
  const pmp2 = calculateNewPMP(48, 145, 52, 155);
  assert.equal(pmp2, 150.2);

  // Case 3: Initial zero or negative stock takes the new buy price directly
  const pmp3 = calculateNewPMP(0, 0, 20, 300);
  assert.equal(pmp3, 300);
});

test('calculateAccountingSummary correctly calculates gross margin, stock valuation, and receivables/payables', () => {
  const mockProducts: Product[] = [
    {
      id: 1,
      barcode: '613001',
      name_fr: 'Huile 5L',
      name_ar: 'زيت 5 لتر',
      category_id: 'epicerie',
      buy_price: 580,
      sell_price: 650,
      tva_rate: 0,
      stock_qty: 10,
      min_stock_alert: 2,
      unit: 'PIECE',
      has_expiry_date: false,
    },
    {
      id: 2,
      barcode: '613002',
      name_fr: 'Chocolat',
      name_ar: 'شوكولاتة',
      category_id: 'confiserie',
      buy_price: 80,
      sell_price: 120,
      tva_rate: 19,
      stock_qty: 20,
      min_stock_alert: 5,
      unit: 'PIECE',
      has_expiry_date: false,
    },
  ];

  const mockSales: Sale[] = [
    {
      id: 'S-1',
      invoice_number: 'FACT-01',
      ticket_number: 'T-01',
      cashier_id: 'C-1',
      cashier_name: 'Amine',
      items: [
        {
          product_id: 1,
          barcode: '613001',
          name_fr: 'Huile 5L',
          name_ar: 'زيت 5 لتر',
          unit_price_ttc: 650,
          quantity: 2,
          unit: 'PIECE',
          tva_rate: 0,
          discount_percent: 0,
          total_line_ht: 1300,
          total_line_tva: 0,
          total_line_ttc: 1300,
        },
      ],
      total_ht: 1300,
      tva_breakdown: {
        0: { rate: 0, base_ht: 1300, tva_amount: 0, total_ttc: 1300 },
        9: { rate: 9, base_ht: 0, tva_amount: 0, total_ttc: 0 },
        19: { rate: 19, base_ht: 0, tva_amount: 0, total_ttc: 0 },
      },
      total_tva: 0,
      timbre_fiscal: 13,
      total_ttc: 1313,
      payment_method: 'ESPECES',
      amount_paid: 1500,
      amount_returned: 187,
      status: 'COMPLETED',
      created_at: new Date().toISOString(),
    },
  ];

  const mockClients: Client[] = [
    {
      id: 2,
      name: 'Karim',
      phone: '0550',
      address: 'Alger',
      credit_balance: 4500,
      max_credit_limit: 10000,
    },
  ];

  const mockSuppliers: Supplier[] = [
    {
      id: 1,
      name: 'CEVITAL AGRO',
      contact_person: 'Ali',
      phone: '021',
      address: 'Bejaia',
      balance_due: 50000,
      category: 'Agroalimentaire',
    },
  ];

  const summary = calculateAccountingSummary(
    mockSales,
    [],
    mockProducts,
    mockClients,
    mockSuppliers,
    [],
    []
  );

  // Sales HT = 1300
  assert.equal(summary.total_sales_ht, 1300);
  // Cost of 2 Huile 5L @ 580 = 1160
  assert.equal(summary.total_cost_of_goods_sold, 1160);
  // Gross margin = 1300 - 1160 = 140 DZD
  assert.equal(summary.gross_margin_dzd, 140);
  // Total stock at PMP: 10 * 580 + 20 * 80 = 5800 + 1600 = 7400 DZD
  assert.equal(summary.total_stock_value_pmp, 7400);
  // Total stock at Retail: 10 * 650 + 20 * 120 = 6500 + 2400 = 8900 DZD
  assert.equal(summary.total_stock_value_retail, 8900);
  // Receivables = 4500
  assert.equal(summary.total_client_receivables, 4500);
  // Payables = 50000
  assert.equal(summary.total_supplier_payables, 50000);
});
