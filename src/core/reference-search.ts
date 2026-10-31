/**
 * Baraka Market — reference catalog PURE kernel (browser-safe, zero imports).
 * Normalizers, token scorer, fiscal category map. Node loader lives in
 * reference-catalog.ts; DAL + UI share this file.
 */

export interface RefCategory {
  code: string;
  nameFr: string;
  nameAr: string;
  defaultTva: 0 | 9 | 19;
}

export interface ProductTemplate {
  id: number;
  brandId: string;
  brandName: string;
  brandNameAr: string;
  manufacturer: string;
  categoryCode: string;
  suggestedNameFr: string;
  suggestedNameAr: string;
  searchAliases: string;
  isWeighable: boolean;
  defaultUnit: 'PIECE' | 'KG' | 'LITRE';
  defaultTva: 0 | 9 | 19;
}

/** Ref C-code → shop rayon id (ProductsStockView filter namespace). */
export const REF_TO_PRODUCT_CATEGORY: Record<string, string> = {
  C001: 'epicerie', C002: 'epicerie', C003: 'epicerie', C004: 'epicerie', C005: 'epicerie',
  C006: 'laiterie', C007: 'laiterie', C023: 'laiterie',
  C008: 'boissons', C009: 'boissons', C010: 'boissons',
  C011: 'confiserie', C012: 'confiserie', C013: 'confiserie',
  C014: 'epicerie', C015: 'hygiene', C016: 'hygiene', C017: 'hygiene', C018: 'hygiene',
  C019: 'hygiene', C020: 'hygiene', C021: 'epicerie', C022: 'epicerie', C024: 'epicerie',
  C025: 'epicerie', C026: 'epicerie', C027: 'epicerie', C028: 'epicerie',
};

/** Latin fold: lowercase, strip diacritics, œ→oe, punctuation→space. */
export function normalizeLatin(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Arabic sanitizer — undoes the classic BiDi/export corruptions:
 * NFKC folds presentation forms (ﻟﺎﻟﺔ → لالة), tatweel stripped,
 * alef/hamza unified, ة→ه + ى→ي for search, tashkeel + Hindi digits folded.
 */
export function sanitizeArabic(s: string): string {
  return s.normalize('NFKC')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\u0600-\u06ff0-9]+/g, ' ').trim();
}

const norm = (s: string): string => `${normalizeLatin(s)} ${sanitizeArabic(s)}`.trim();

/**
 * Token scorer: every query token must hit brand (×3), name (×2) or alias
 * (×1); brand-prefix hits sort first so "elio" → Elio oils, not noise.
 */
export function searchCatalog(
  templates: ProductTemplate[], query: string, limit = 8,
): ProductTemplate[] {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const scored: { t: ProductTemplate; s: number }[] = [];
  for (const t of templates) {
    const brand = norm(`${t.brandName} ${t.brandNameAr}`);
    const names = norm(`${t.suggestedNameFr} ${t.suggestedNameAr}`);
    const alias = norm(t.searchAliases);
    let s = 0;
    for (const tok of tokens) {
      if (brand.split(' ').some(w => w.startsWith(tok))) s += 3;
      else if (brand.includes(tok)) s += 2;
      else if (names.includes(tok)) s += 2;
      else if (alias.split(/[\s|]+/).some(w => w === tok || w.startsWith(tok))) s += 1;
      else { s = 0; break; }
    }
    if (s > 0) scored.push({ t, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.t.id - b.t.id)
    .slice(0, Math.max(1, Math.min(25, limit))).map(r => r.t);
}
