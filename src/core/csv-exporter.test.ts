import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStockCsv, stockCsvFilename, STOCK_CSV_HEADERS } from './csv-exporter.js';
import { preflightCsv } from './csv-importer.js';
import type { Product } from '../types/index.js';

const P = (o: Partial<Product>): Product => ({
  id: 1, barcode: '6130000000015', name_fr: 'HUILE ELIO 5L', name_ar: 'زيت',
  category_id: 'epicerie', buy_price: 580, sell_price: 650, tva_rate: 0,
  stock_qty: 50, min_stock_alert: 5, unit: 'PIECE', has_expiry_date: false, ...o,
});

test('csv-export: header + BOM + one line round-trips through the importer', () => {
  const csv = buildStockCsv([P({}), P({ id: 2, barcode: 'x2', name_fr: 'Lait "doux"; frais', tva_rate: 9, sell_price: 140.5, stock_qty: 12.5, unit: 'LITRE', category_id: 'boissons' })]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.split('\n')[0].replace('﻿', '') === STOCK_CSV_HEADERS);
  const rep = preflightCsv(csv);
  assert.deepEqual(rep.errors, []);
  assert.equal(rep.validRows.length, 2);
  const [a, b] = rep.validRows;
  assert.equal(a.barcode, '6130000000015');
  assert.equal(a.priceCt, 65000);
  assert.equal(a.tvaRate, 0);
  assert.equal(a.stockMilli, 50000);
  assert.equal(b.name_fr, 'Lait "doux"; frais'); // quoting survives
  assert.equal(b.priceCt, 14050);
  assert.equal(b.stockMilli, 12500);
  assert.equal(b.unit, 'LITRE');
});

test('csv-export: filename stamps date', () => {
  assert.equal(stockCsvFilename(new Date('2026-11-03T10:05:00')), 'baraka-stock-20261103-1005.csv');
});
