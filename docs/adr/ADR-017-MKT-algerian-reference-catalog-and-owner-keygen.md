# ADR-017-MKT: Algerian Reference Catalog & Owner Keygen Utility

* **Status:** ACCEPTED
* **Date:** 2026-10-26 (Africa/Algiers)
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Catalog onboarding was the slowest shop floor operation: every product
required manual FR/AR names, rayon, TVA and unit. The Owner supplied a
25-page Algerian supermarket reference (28 fiscal categories, 252 brands).
Separately, license issuance needed a one-click Owner tool that cannot
emit a defective key.

## Decision

1. **Dataset** (`src/data/algerian-catalog.json`): 28 `C001–C028` categories
   with legal TVA defaults (0% staples C001–C003/C006–C007, 9% C022,
   19% elsewhere; per-template `tva` override for the C006 split — milk 0%
   vs desserts 19%), 257 templates / 112 brands with sanitized logical-order
   Arabic, aliases and weighable/unit flags.
2. **Pure browser-safe kernel** (`core/reference-search.ts`): Latin fold +
   Arabic sanitizer (NFKC presentation-form fold, tatweel/tashkeel strip,
   alef/ة/ى folding) + token scorer (brand-prefix ×3, name ×2, alias ×1,
   AND semantics). Node loader (`core/reference-catalog.ts`) only adds fs.
3. **DAL + REST**: `ref_categories`/`ref_templates` DDL in `db/schema.sql`,
   idempotent open-time seed (row-count guard, single transaction),
   `searchProductTemplates` (in-memory scan over 257 rows — sub-ms, no
   FTS dependency), `GET /api/reference/templates` DTO with
   `productCategory` rayon mapping.
4. **UI**: ProductsStockView name field debounces (220ms) to the loopback
   lane; picking a hit fills nameFr/nameAr/TVA/unit/rayon and focuses cost
   price (Tab → sale price → stock). Add-mode only; edit-mode untouched.
5. **Owner keygen** (`scripts/keygen-gui.ts` + `generate-license.cmd`,
   `npm run keygen:gui`): interactive/argv, BM-HWID gate, offline sign,
   public-seal self-check (abort on INVALID — zero defective keys), plus a
   ready-to-send Arabic WhatsApp/SMS line.

## Consequences

* Positive: onboarding drops to quantity + two prices; catalog is data, not
  code — new brands ship as JSON rows.
* Accepted: `verify:release` moves 20 → 22 tables; search is in-memory
  (257 rows) rather than SQLite FTS — KISS until the catalog grows 10×.
