/**
 * Baraka Market — Algerian reference catalog engine (TASK-BRK-016-MKT).
 * Zero-friction onboarding: type "elio"/"ايليو"/"tango" and the modal fills
 * name, category, TVA and unit — the operator only enters prices + stock.
 * KISS: JSON dataset + pure normalizers + token scorer; DAL caches rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sanitizeArabic, normalizeLatin, searchCatalog, REF_TO_PRODUCT_CATEGORY,
  type RefCategory, type ProductTemplate,
} from './reference-search.js';

export type { RefCategory, ProductTemplate };
export { sanitizeArabic, normalizeLatin, searchCatalog, REF_TO_PRODUCT_CATEGORY };

interface RawTpl {
  b: string; bar: string; m: string; c: string; fr: string; ar: string;
  a: string; w: number; u: string; tva?: number;
}

let cache: { cats: RefCategory[]; templates: ProductTemplate[] } | null = null;

/** Load + expand the JSON dataset (cached; pure — safe for tests). */
export function loadReferenceCatalog(): { cats: RefCategory[]; templates: ProductTemplate[] } {
  if (cache) return cache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'algerian-catalog.json'), 'utf8')) as {
    categories: { code: string; fr: string; ar: string; tva: number }[]; templates: RawTpl[];
  };
  const tvaOf = new Map(raw.categories.map(c => [c.code, c.tva as 0 | 9 | 19]));
  const cats = raw.categories.map(c => ({
    code: c.code, nameFr: c.fr, nameAr: sanitizeArabic(c.ar), defaultTva: c.tva as 0 | 9 | 19,
  }));
  const templates = (raw.templates as unknown[]).filter((t): t is RawTpl => typeof t === 'object' && t !== null)
    .map((t, i) => ({
      id: i + 1,
      brandId: normalizeLatin(t.b).replace(/[^a-z0-9]+/g, '-'),
      brandName: t.b,
      brandNameAr: sanitizeArabic(t.bar),
      manufacturer: t.m,
      categoryCode: t.c,
      suggestedNameFr: t.fr,
      suggestedNameAr: sanitizeArabic(t.ar),
      searchAliases: t.a,
      isWeighable: t.w === 1,
      defaultUnit: (t.u === 'KG' || t.u === 'LITRE' ? t.u : 'PIECE') as ProductTemplate['defaultUnit'],
      defaultTva: (t.tva ?? tvaOf.get(t.c) ?? 19) as 0 | 9 | 19,
    }));
  cache = { cats, templates };
  return cache;
}
