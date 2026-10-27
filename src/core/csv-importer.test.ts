import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightCsv, detectDelimiter, splitCsvRows } from './csv-importer.js';
import { openBarakaDb } from '../db/sqlite.js';
import type { ImportProductRow } from '../types/index.js';

// ---- ADR-009-MKT: bulk CSV import engine ----
test('csv: semicolon FR headers parse with centimes + milli', () => {
  const csv = 'code_barre;designation;prix_achat;prix_vente;tva;stock;unite;rayon\n6130000000014;Lait Candia;145;180;9;48;PIECE;laiterie';
  const r = preflightCsv(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.summary.total, 1);
  assert.equal(r.summary.valid, 1);
  const row = r.validRows[0];
  assert.equal(row.barcode, '6130000000014');
  assert.equal(row.name_fr, 'Lait Candia');
  assert.equal(row.buyPriceCt, 14500);
  assert.equal(row.priceCt, 18000);
  assert.equal(row.tvaRate, 9);
  assert.equal(row.stockMilli, 48000);
  assert.equal(row.unit, 'PIECE');
  assert.equal(row.category, 'laiterie');
});

test('csv: comma EN headers parse with defaults', () => {
  const csv = 'barcode,name,buy_price,price\n6130000000021,Cheese,200,250';
  const r = preflightCsv(csv);
  assert.equal(r.errors.length, 0);
  const row = r.validRows[0];
  assert.equal(row.tvaRate, 0);
  assert.equal(row.stockMilli, 0);
  assert.equal(row.unit, 'PIECE');
  assert.equal(row.category, 'Général');
});

test('csv: TVA 14 rejected with field error', () => {
  const csv = 'barcode,name,price,tva\n6130000000038,Soap,100,14';
  const r = preflightCsv(csv);
  assert.equal(r.validRows.length, 0);
  assert.equal(r.summary.errorsCount, 1);
  assert.deepEqual(r.errors[0], { row: 2, field: 'tva', message: 'TVA must be 0, 9, or 19' });
});

test('csv: duplicate barcodes flagged on second occurrence', () => {
  const csv = 'barcode,name,price\n613A,Milk,180\n613A,Milk bis,190\n613B,Bread,50';
  const r = preflightCsv(csv);
  assert.equal(r.validRows.length, 2);
  assert.equal(r.summary.errorsCount, 1);
  assert.equal(r.errors[0].row, 3);
  assert.match(r.errors[0].message, /Duplicate barcode/);
});

test('csv: empty lines and whitespace tolerated', () => {
  const csv = 'barcode , name , price\n\n  613C ,  Yogurt  , 120 \n\n';
  const r = preflightCsv(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.validRows.length, 1);
  assert.equal(r.validRows[0].barcode, '613C');
  assert.equal(r.validRows[0].priceCt, 12000);
});

test('csv: quoted fields with embedded delimiter + decimal comma', () => {
  const csv = 'code_barre;designation;prix_vente;stock\n613D;"Huile; 5L";1250,5;10,5';
  const r = preflightCsv(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.validRows[0].name_fr, 'Huile; 5L');
  assert.equal(r.validRows[0].priceCt, 125050);
  assert.equal(r.validRows[0].stockMilli, 10500);
});

test('csv: negative price and bad stock rejected', () => {
  const csv = 'barcode,name,buy_price,price,stock\n613E,X,-5,100,2\n613F,Y,10,abc,3';
  const r = preflightCsv(csv);
  assert.equal(r.validRows.length, 0);
  assert.equal(r.summary.errorsCount, 2);
  assert.equal(r.errors[0].field, 'buy_price');
  assert.equal(r.errors[1].field, 'price');
});

test('csv: detector picks semicolon vs comma', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.deepEqual(splitCsvRows('a;"b;c";d', ';'), [['a', 'b;c', 'd']]);
});

test('csv: name_fr/name_ar split headers honored', () => {
  const csv = 'barcode,name_fr,name_ar,price\n613G,Milk,حليب,180';
  const r = preflightCsv(csv);
  assert.equal(r.validRows[0].name_fr, 'Milk');
  assert.equal(r.validRows[0].name_ar, 'حليب');
});

test('db: batch UPSERT inserts then merges stock', () => {
  const b = openBarakaDb(':memory:');
  const rows: ImportProductRow[] = [
    { barcode: '613H', name: 'Milk', buyPriceCt: 14500, priceCt: 18000, tvaRate: 9, stockMilli: 48000, category: 'laiterie', unit: 'PIECE' },
    { barcode: '613I', name: 'Bread', buyPriceCt: 2000, priceCt: 2500, tvaRate: 0, stockMilli: 100000, category: 'boulangerie', unit: 'PIECE' },
  ];
  assert.deepEqual(b.importProductsBatch(rows, 'UPSERT'), { inserted: 2, updated: 0, failed: 0 });
  const prod = b.db.prepare('SELECT * FROM products WHERE barcode = ?').get('613H') as Record<string, unknown>;
  assert.equal(prod.sell_price_ct, 18000);
  assert.equal(prod.stock_milli, 48000);
  const again: ImportProductRow[] = [
    { barcode: '613H', name: 'Milk New', buyPriceCt: 15000, priceCt: 19000, tvaRate: 9, stockMilli: 2000, category: 'laiterie', unit: 'PIECE' },
  ];
  assert.deepEqual(b.importProductsBatch(again, 'UPSERT'), { inserted: 0, updated: 1, failed: 0 });
  const merged = b.db.prepare('SELECT * FROM products WHERE barcode = ?').get('613H') as Record<string, unknown>;
  assert.equal(merged.sell_price_ct, 19000);
  assert.equal(merged.stock_milli, 50000);
  b.close();
});

test('db: batch INSERT_ONLY skips duplicates cleanly', () => {
  const b = openBarakaDb(':memory:');
  const mk = (barcode: string): ImportProductRow =>
    ({ barcode, name: 'X', buyPriceCt: 100, priceCt: 200, tvaRate: 0, stockMilli: 1000, category: 'Général', unit: 'PIECE' });
  assert.deepEqual(b.importProductsBatch([mk('613J')], 'INSERT_ONLY'), { inserted: 1, updated: 0, failed: 0 });
  assert.deepEqual(b.importProductsBatch([mk('613J'), mk('613K')], 'INSERT_ONLY'), { inserted: 1, updated: 0, failed: 1 });
  b.close();
});

test('db: batch validates money and rejects bad mode atomically', () => {
  const b = openBarakaDb(':memory:');
  assert.throws(() => b.importProductsBatch([], 'NOPE' as never), /INSERT_ONLY\|UPSERT/);
  assert.throws(() => b.importProductsBatch(
    [{ barcode: '613L', name: 'X', buyPriceCt: 10.5, priceCt: 200, tvaRate: 0, stockMilli: 1000, category: 'G', unit: 'PIECE' }],
    'UPSERT',
  ), /buyPriceCt/);
  assert.equal((b.db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n, 0);
  b.close();
});
