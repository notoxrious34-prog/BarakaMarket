import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CENTIMES_PER_DZD,
  dzdToCentimes,
  assertIntegerCentimes,
  formatDZDFromCentimes,
} from './money.js';
import {
  calculateLineTotalsCt,
  calculateTimbreFiscalCt,
  calculateSaleTotalsCt,
  parseScaleBarcodeCt,
} from './fiscal.centimes.js';

// ---- money.ts ----
test('money: DZD <-> centimes conversion is exact, float rejected', () => {
  assert.equal(CENTIMES_PER_DZD, 100);
  assert.equal(dzdToCentimes(180), 18000);
  assert.equal(dzdToCentimes(330.28), 33028);
  // 0.1+0.2 float trap must NOT leak: conversion rounds to integer
  assert.equal(dzdToCentimes(0.1 + 0.2), 30);
  assert.throws(() => assertIntegerCentimes(10.5), /integer/i);
  assert.throws(() => assertIntegerCentimes(NaN), /integer/i);
  assert.doesNotThrow(() => assertIntegerCentimes(1800));
});

test('money: formatDZDFromCentimes groups thousands', () => {
  assert.equal(formatDZDFromCentimes(179400), '1 794.00 DZD');
  assert.equal(formatDZDFromCentimes(1800, false), '18 DZD');
});

// ---- fiscal.centimes.ts : line totals (golden values from legacy float suite) ----
test('fiscal.ct: line totals TVA 0/9/19 in integer centimes', () => {
  // TVA 0%: Huile Elio 650 DZD x1
  const l0 = calculateLineTotalsCt(65000, 1, 0);
  assert.equal(l0.total_line_ttc_ct, 65000);
  assert.equal(l0.total_line_ht_ct, 65000);
  assert.equal(l0.total_line_tva_ct, 0);

  // TVA 9%: Lait 180 DZD x2 = 36000ct -> HT 33028ct, TVA 2972ct
  const l9 = calculateLineTotalsCt(18000, 2, 9);
  assert.equal(l9.total_line_ttc_ct, 36000);
  assert.equal(l9.total_line_ht_ct, 33028);
  assert.equal(l9.total_line_tva_ct, 2972);

  // TVA 19%: Chocolat 120 x3 = 36000ct -> HT 30252ct, TVA 5748ct
  const l19 = calculateLineTotalsCt(12000, 3, 19);
  assert.equal(l19.total_line_ttc_ct, 36000);
  assert.equal(l19.total_line_ht_ct, 30252);
  assert.equal(l19.total_line_tva_ct, 5748);

  // Invariant: HT + TVA === TTC exactly (no float drift)
  for (const l of [l0, l9, l19]) {
    assert.equal(l.total_line_ht_ct + l.total_line_tva_ct, l.total_line_ttc_ct);
    assert.ok(Number.isInteger(l.total_line_ht_ct));
  }
});

test('fiscal.ct: KG quantity with decimals stays integer', () => {
  // Pommes 280 DZD/kg x 1.45kg = 40600ct -> HT 37248ct, TVA 3352ct
  const lkg = calculateLineTotalsCt(28000, 1.45, 9);
  assert.equal(lkg.total_line_ttc_ct, 40600);
  assert.equal(lkg.total_line_ht_ct, 37248);
  assert.equal(lkg.total_line_tva_ct, 3352);
});

test('fiscal.ct: discount applied before HT extraction', () => {
  // 1000 DZD -10% = 90000ct TTC, TVA 19% -> HT round(90000*100/119)=75630ct
  const ld = calculateLineTotalsCt(100000, 1, 19, 10);
  assert.equal(ld.total_line_ttc_ct, 90000);
  assert.equal(ld.total_line_ht_ct, 75630);
  assert.equal(ld.total_line_tva_ct, 90000 - 75630);
});

test('fiscal.ct: rejects invalid TVA rate', () => {
  assert.throws(() => calculateLineTotalsCt(10000, 1, 7 as never), /TVA/i);
});

// ---- timbre ----
test('fiscal.ct: timbre 1% cash-only, ceil, floor 10, cap 2500, exempt <50', () => {
  // 1776 DZD =177600ct cash -> ceil(17.76)=18 DZD =1800ct
  assert.equal(calculateTimbreFiscalCt(177600, 'ESPECES'), 1800);
  // 200 DZD -> 2 DZD -> floor to 10 DZD =1000ct
  assert.equal(calculateTimbreFiscalCt(20000, 'ESPECES'), 1000);
  // cap: 300000 DZD -> 3000 -> capped 2500 DZD =250000ct
  assert.equal(calculateTimbreFiscalCt(30000000, 'ESPECES'), 250000);
  // exempt <50 DZD
  assert.equal(calculateTimbreFiscalCt(4900, 'ESPECES'), 0);
  assert.equal(calculateTimbreFiscalCt(5000, 'ESPECES'), 1000); // 50 DZD -> 0.5->ceil 1 -> floor 10
  // electronic / credit = 0
  assert.equal(calculateTimbreFiscalCt(177600, 'CIB'), 0);
  assert.equal(calculateTimbreFiscalCt(177600, 'DAHABIYA'), 0);
  assert.equal(calculateTimbreFiscalCt(177600, 'CREDIT'), 0);
});

// ---- sale totals ----
test('fiscal.ct: full Algerian receipt 1776 + timbre 18 = 1794', () => {
  const items = [
    { tva_rate: 9 as const, ...calculateLineTotalsCt(18000, 2, 9) },
    { tva_rate: 0 as const, ...calculateLineTotalsCt(65000, 1, 0) },
    { tva_rate: 19 as const, ...calculateLineTotalsCt(12000, 3, 19) },
    { tva_rate: 9 as const, ...calculateLineTotalsCt(28000, 1.45, 9) },
  ];
  const t = calculateSaleTotalsCt(items, 'ESPECES');
  assert.equal(t.timbre_ct, 1800);
  assert.equal(t.total_ttc_ct, 179400);
  assert.equal(t.tva_breakdown[0].total_ttc_ct, 65000);
  assert.equal(t.tva_breakdown[9].total_ttc_ct, 76600);
  assert.equal(t.tva_breakdown[19].total_ttc_ct, 36000);
  // HT+TVA === TTC invariant globally
  assert.equal(t.total_ht_ct + t.total_tva_ct + t.timbre_ct, t.total_ttc_ct);
});

// ---- scale barcode ----
test('fiscal.ct: scale barcode 20/22 parsing', () => {
  const r = parseScaleBarcodeCt('2000040014501');
  assert.equal(r.isScale, true);
  assert.equal(r.itemCode, '00040');
  assert.equal(r.weightKg, 1.45);
  const reg = parseScaleBarcodeCt('6130000000014');
  assert.equal(reg.isScale, false);
});
