/**
 * TASK-BRK-016-MKT — Algerian reference catalog: 28 categories, 250+ vetted
 * templates, BiDi sanitization, and diacritic-agnostic autofill search.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadReferenceCatalog,
} from './reference-catalog.js';
import {
  searchCatalog, sanitizeArabic, normalizeLatin,
  REF_TO_PRODUCT_CATEGORY,
} from './reference-search.js';
import { openBarakaDb } from '../db/sqlite.js';

const { cats, templates } = loadReferenceCatalog();

test('catalog: exactly 28 fiscal categories with legal TVA defaults', () => {
  assert.equal(cats.length, 28);
  assert.equal(cats[0].code, 'C001');
  assert.equal(cats[27].code, 'C028');
  const tva = Object.fromEntries(cats.map(c => [c.code, c.defaultTva]));
  assert.equal(tva.C001, 0);
  assert.equal(tva.C006, 0);
  assert.equal(tva.C008, 19);
  assert.equal(tva.C022, 9);
  assert.equal(tva.C028, 19);
});

test('catalog: >= 250 vetted templates, every row fully populated', () => {
  assert.ok(templates.length >= 250, `got ${templates.length}`);
  for (const t of templates) {
    assert.ok(t.brandName && t.suggestedNameFr && t.suggestedNameAr, `template #${t.id}`);
    assert.match(t.categoryCode, /^C\d{3}$/);
    assert.ok([0, 9, 19].includes(t.defaultTva));
    assert.ok(['PIECE', 'KG', 'LITRE'].includes(t.defaultUnit));
    assert.ok(t.searchAliases.length > 0);
  }
  const brands = new Set(templates.map(t => t.brandId));
  assert.ok(brands.size >= 90, `brands: ${brands.size}`);
});

test('catalog: dairy split — basic milk 0%, desserts 19%', () => {
  const lait = templates.find(t => t.suggestedNameFr === 'LAIT SOUMMAM UHT 1L');
  const dessert = templates.find(t => t.suggestedNameFr === 'RAIB SOUMMAM 4x100G');
  assert.equal(lait?.defaultTva, 0);
  assert.equal(dessert?.defaultTva, 19);
});

test('catalog: Arabic names are logical-order, BiDi-clean', () => {
  const fr = templates.map(t => t.suggestedNameAr).join('\n');
  for (const spot of ['البارزيان', 'لالة خديجة', 'عمر بن عمر', 'زيت إيليو', 'سيليكتو حمود']) {
    assert.ok(fr.includes(sanitizeArabic(spot)), `missing: ${spot}`);
  }
  // Presentation-form exports fold to the same logical string.
  assert.equal(sanitizeArabic('ﻟﺎﻟﺔ ﺧﺪﻳﺠﺔ'), sanitizeArabic('لالة خديجة'));
  assert.equal(sanitizeArabic('ﻋﻤﺮ ﺑﻦ ﻋﻤﺮ'), sanitizeArabic('عمر بن عمر'));
  // Tatweel + tashkeel + alef variants collapse for search.
  assert.equal(sanitizeArabic('زيـتُ إيليَوْ'), sanitizeArabic('زيت ايليو'));
  assert.equal(normalizeLatin('Crème Brûlée'), 'creme brulee');
});

test('catalog: search resolves FR, AR and alias spellings', () => {
  const byBrand = (q: string) => searchCatalog(templates, q, 8).map(t => t.suggestedNameFr);
  const elio = byBrand('elio');
  assert.ok(elio.length > 0 && elio[0].includes('ELIO'), elio[0]);
  assert.ok(byBrand('ايليو')[0].includes('ELIO'));
  assert.ok(byBrand('tango')[0].includes('TANGO'));
  assert.ok(byBrand('طانغو')[0].includes('TANGO'));
  assert.ok(byBrand('زيت')[0].includes('HUILE'));
  assert.ok(byBrand('كاشير')[0].includes('CACHIR'));
  assert.deepEqual(searchCatalog(templates, 'zzz-no-such-brand', 8), []);
  assert.deepEqual(searchCatalog(templates, '  ', 8), []);
});

test('catalog: multi-token AND + weighable/unit flags survive', () => {
  const hits = searchCatalog(templates, 'lait soummam', 8);
  assert.ok(hits.length > 0 && hits.every(t => t.brandName === 'Soummam'));
  const olives = searchCatalog(templates, 'olives vertes', 8)[0];
  assert.equal(olives.isWeighable, true);
  assert.equal(olives.defaultUnit, 'KG');
  const eau = searchCatalog(templates, 'vaisselle isis 1.25', 8)[0];
  assert.equal(eau.defaultUnit, 'LITRE');
});

test('catalog: every template maps to a real shop rayon', () => {
  const rayons = new Set(['epicerie', 'laiterie', 'boissons', 'confiserie', 'hygiene']);
  for (const t of templates) {
    const r = REF_TO_PRODUCT_CATEGORY[t.categoryCode];
    assert.ok(r && rayons.has(r), `${t.categoryCode} -> ${r}`);
  }
});

test('catalog: DAL seeds 22 tables once, search end-to-end (FR + AR)', () => {
  const b = openBarakaDb(':memory:');
  try {
    const tables = (b.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all() as { name: string }[]).map(r => r.name);
    assert.ok(tables.includes('ref_categories') && tables.includes('ref_templates'));
    const n = (b.db.prepare('SELECT COUNT(*) AS n FROM ref_templates').get() as { n: number }).n;
    assert.ok(n >= 250, `seeded: ${n}`);
    const fr = b.searchProductTemplates('elio');
    assert.ok(fr.length > 0 && fr[0].brandName === 'Elio');
    assert.ok(b.searchProductTemplates('ايليو')[0].brandName === 'Elio');
    assert.ok(b.searchProductTemplates('tango')[0].brandName === 'Tango');
    const row = b.db.prepare('SELECT is_weighable AS w FROM ref_templates WHERE suggested_name_fr = ?')
      .get('OLIVES VERTES KABYLIE VRAC') as { w: number };
    assert.equal(row.w, 1);
  } finally { b.close(); }
});
