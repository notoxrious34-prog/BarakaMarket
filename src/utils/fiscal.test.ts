import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLineTotals,
  calculateTimbreFiscal,
  calculateSaleTotals,
  parseScaleBarcode,
  formatDZD,
  numberToWordsFR,
  numberToWordsAR,
  computeActivationKey
} from './fiscal';
import { SaleItem } from '../types';

test('calculateLineTotals correctly calculates HT and TVA for 0%, 9%, and 19%', () => {
  // TVA 0% (Huile Elio / Pain / Lait exempt)
  const item0 = calculateLineTotals(650, 1, 0);
  assert.equal(item0.total_line_ttc, 650);
  assert.equal(item0.total_line_ht, 650);
  assert.equal(item0.total_line_tva, 0);

  // TVA 9% (Lait Condensé 2 x 180 = 360 TTC)
  // HT = 360 / 1.09 = 330.28, TVA = 29.72
  const item9 = calculateLineTotals(180, 2, 9);
  assert.equal(item9.total_line_ttc, 360);
  assert.equal(item9.total_line_ht, 330.28);
  assert.equal(item9.total_line_tva, 29.72);

  // TVA 19% (Chocolat 3 x 120 = 360 TTC)
  // HT = 360 / 1.19 = 302.52, TVA = 57.48
  const item19 = calculateLineTotals(120, 3, 19);
  assert.equal(item19.total_line_ttc, 360);
  assert.equal(item19.total_line_ht, 302.52);
  assert.equal(item19.total_line_tva, 57.48);
});

test('calculateTimbreFiscal applies 1% on cash payments and 0 on cards or credit', () => {
  // Cash payment (ESPECES): 1% of 1776 = 17.76 -> Math.ceil gives 18 DZD
  const timbreCash = calculateTimbreFiscal(1776, 'ESPECES');
  assert.equal(timbreCash, 18);

  // Min stamp duty floor (e.g. 10 DZD)
  const timbreSmall = calculateTimbreFiscal(200, 'ESPECES');
  assert.equal(timbreSmall, 10);

  // CIB or Dahabiya electronic payment: Stamp duty is EXEMPT (0 DZD)
  const timbreCIB = calculateTimbreFiscal(1776, 'CIB');
  assert.equal(timbreCIB, 0);

  const timbreDahabiya = calculateTimbreFiscal(1776, 'DAHABIYA');
  assert.equal(timbreDahabiya, 0);

  // Credit sale: 0 DZD timbre until settled in cash
  const timbreCredit = calculateTimbreFiscal(1776, 'CREDIT');
  assert.equal(timbreCredit, 0);
});

test('calculateSaleTotals matches the Algerian legal supermarket receipt specification', () => {
  const mockItems: SaleItem[] = [
    {
      product_id: 1,
      barcode: '613000000001',
      name_fr: 'LAIT CONDENSE',
      name_ar: 'حليب مكثف',
      unit_price_ttc: 180,
      quantity: 2,
      unit: 'PIECE',
      tva_rate: 9,
      discount_percent: 0,
      total_line_ht: 330.28,
      total_line_tva: 29.72,
      total_line_ttc: 360,
    },
    {
      product_id: 2,
      barcode: '613000000002',
      name_fr: 'HUILE ELIO 5L',
      name_ar: 'زيت إيليو 5 لتر',
      unit_price_ttc: 650,
      quantity: 1,
      unit: 'PIECE',
      tva_rate: 0,
      discount_percent: 0,
      total_line_ht: 650.00,
      total_line_tva: 0.00,
      total_line_ttc: 650,
    },
    {
      product_id: 3,
      barcode: '613000000003',
      name_fr: 'CHOCOLAT NOIR',
      name_ar: 'شوكولاتة سوداء',
      unit_price_ttc: 120,
      quantity: 3,
      unit: 'PIECE',
      tva_rate: 19,
      discount_percent: 0,
      total_line_ht: 302.52,
      total_line_tva: 57.48,
      total_line_ttc: 360,
    },
    {
      product_id: 4,
      barcode: '2000040014501',
      name_fr: 'POMMES LOCAL (KG)',
      name_ar: 'تفاح محلي',
      unit_price_ttc: 280,
      quantity: 1.45,
      unit: 'KG',
      tva_rate: 9,
      discount_percent: 0,
      total_line_ht: 372.48,
      total_line_tva: 33.52,
      total_line_ttc: 406,
    },
  ];

  const totals = calculateSaleTotals(mockItems, 'ESPECES');

  // Total TTC before timbre is 360 + 650 + 360 + 406 = 1776
  // Timbre is 18 DZD
  // Final TTC with timbre is 1776 + 18 = 1794 (or 1776 + 18)
  assert.equal(totals.timbre_fiscal, 18);
  assert.equal(totals.tva_breakdown[0].total_ttc, 650);
  assert.equal(totals.tva_breakdown[9].total_ttc, 766);
  assert.equal(totals.tva_breakdown[19].total_ttc, 360);
});

test('parseScaleBarcode identifies 20 prefix scale barcode and extracts weight in kg', () => {
  // Barcode 2000040014501: 20 prefix, item code 00040, weight 01450 grams (1.45 kg), check digit 1
  const result = parseScaleBarcode('2000040014501');
  assert.equal(result.isScale, true);
  assert.equal(result.itemCode, '00040');
  assert.equal(result.weightKg, 1.45);

  // Standard non-scale barcode (e.g. 613000000001)
  const regular = parseScaleBarcode('6130000000014');
  assert.equal(regular.isScale, false);
});

test('numberToWordsFR and numberToWordsAR format invoice text correctly', () => {
  const textFR = numberToWordsFR(1776);
  assert.match(textFR, /Mille/);
  assert.match(textFR, /Dinars Algériens/);

  const textAR = numberToWordsAR(1776);
  assert.match(textAR, /ألف/);
  assert.match(textAR, /دينار جزائري/);
});

test('computeActivationKey produces consistent BarakaDEV key', () => {
  const hwid = 'BM-A8DF-92KJ-4XLP';
  const key1 = computeActivationKey(hwid);
  const key2 = computeActivationKey(hwid);
  assert.equal(key1, key2);
  assert.match(key1, /^KEY-[0-9A-F]{4}-[0-9A-F]{4}-BARAKA$/);
});
