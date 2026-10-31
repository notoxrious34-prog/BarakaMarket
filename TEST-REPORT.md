# TEST REPORT — Baraka Market v1.0.0-GA
Date: 2026-10-27 · Commit: `fd23dd7` (tag `v1.0.0`) · Runner: `npm run test:all` (tsx --test, node:test) · `npm run lint` (tsc --noEmit) · `npm run build` (vite)

| Suite | File | Tests | Result |
|---|---|---|---|
| Centimes engine | src/core/fiscal.centimes.test.ts | 18 | ✅ 18/18 |
| UI bridge parity (grid + golden) | src/core/cart-bridge.test.ts | 2 | ✅ 2/2 |
| Settlement fiscal (Art.136) | src/core/settlement.fiscal.test.ts | 4 | ✅ 4/4 |
| Licensing (Ed25519) + SHA-256 cross-check | src/core/licensing.test.ts | 13 | ✅ 13/13 |
| Z-report chain | src/core/zreport.test.ts | 4 | ✅ 4/4 |
| ESC/POS thermal buffers | src/hardware/escpos.test.ts | 7 | ✅ 7/7 |
| Scanner burst + scale | src/hardware/scanner.test.ts | 5 | ✅ 5/5 |
| Synthesized audio | src/hardware/sound.test.ts | 2 | ✅ 2/2 |
| Legacy accounting (no regression) | src/utils/accounting.test.ts | 2 | ✅ 2/2 |
| SQLite WAL layer + colisage DAL | src/db/sqlite.test.ts | 14 | ✅ 14/14 |
| Z-report persistence | src/db/zreport.test.ts | 2 | ✅ 2/2 |
| Live API (loopback + raw-print) | server/index.test.ts | 18 | ✅ 18/18 |
| Colisage math (pure) | src/core/colisage.test.ts | 5 | ✅ 5/5 |
| Cash tender math (pure) | src/core/cash-tender.test.ts | 8 | ✅ 8/8 |
| Loss ledger + expiry radar | src/db/loss.test.ts | 9 | ✅ 9/9 |
| Bulk CSV import engine | src/core/csv-importer.test.ts | 12 | ✅ 12/12 |
| Shelf-edge labels + EAN-13 | src/core/shelf-labels.test.ts | 10 | ✅ 10/10 |
| Supplier BL receiving | src/db/purchases.test.ts | 14 | ✅ 14/14 |
| Client credit settlement | src/db/settlement.test.ts | 10 | ✅ 10/10 |
| Cash sessions + Z closure | src/db/cash-session.test.ts | 7 | ✅ 7/7 |
| Void audit + PIN gate | src/db/void-log.test.ts | 9 | ✅ 9/9 |
| Manager PIN + override | src/core/security.test.ts | 4 | ✅ 4/4 |
| Online backup + restore | src/db/backup.test.ts | 7 | ✅ 7/7 |
| Reference catalog (28 cats, 257 tpl, BiDi, search) | src/core/reference-catalog.test.ts | 8 | ✅ 8/8 |
| Reference templates REST lane | server/index.test.ts | +1 | ✅ 1/1 |
| **Total** | **24 files** | **195** | **✅ 195/195, 0 fail** |

- `tsc --noEmit`: EXIT 0, empty log.
- `vite build`: success, `dist/` 1.6MB (< 2.5MB gate), zero warnings.
- Gate floor: must never regress below 58/58 (Constitution v2-MKT §4) — 195/195 holds.
- ADR-017-MKT (2026-10-26): Algerian reference catalog (257 templates/112 brands,
  28 fiscal categories, BiDi sanitizer, token scorer), `ref_*` seed + REST lane,
  product-modal autofill, standalone Owner keygen GUI with seal self-check.
- ADR-015-MKT (2026-10-27): VACUUM INTO hot snapshots with SHA-256 journal,
  tamper-evident catalog, magic-bytes + integrity pre-flight, quarantine-first
  restore drill with server re-provisioning, 4 backup REST lanes.
- ADR-014-MKT (2026-10-27): salted SHA-256 manager PIN (constant-time,
  default 1234), override bridge for 4 gated actions, append-only void
  journal coexisting with sale voids, 5 security REST lanes.
- ADR-013-MKT (2026-10-27): cash sessions (float/movements/live
  theoretical), atomic Z closure reusing the hash chain, bilingual thermal Z
  ticket with DEFICIT/EXCEDENT/PARFAIT verdict, 4 cash REST lanes.
- ADR-012-MKT (2026-10-27): Carnet de Dette settlement (atomic balance +
  Art.136 timbre + Q-seq), credit ceiling gate, bilingual thermal quittance,
  3 client REST lanes.
- ADR-011-MKT (2026-10-27): supplier BL engine — atomic influx (packs×mult×1000),
  HT/TVA/TTC line splits, buy/sell cost refresh, balance_due_ct debt, 3 REST lanes.
- ADR-010-MKT (2026-10-27): EAN-13 vector SVG (L/G/R + guards) + A4 3×8 HTML
  sheets + 80mm thermal strips with scissor lines; 2 label REST endpoints.
- ADR-009-MKT (2026-10-27): zero-dep CSV importer (`;`/`,` auto-detect, FR/EN
  aliases, dry-run preflight) + atomic `importProductsBatch` (UPSERT/INSERT_ONLY)
  + 2 REST endpoints; real-schema mapping (no price_ct/updated_at).
- ADR-008-MKT (2026-10-27): pixel refinement — navbar rail flex-1/min-w-0 +
  shrink-0 tabs, Caisse (F1)→Caisse, rail px-2, theme-aware disabled checkout
  + `@custom-variant dark` root-cause fix, light-harmonized status footer.
- ADR-007-MKT (2026-10-27): cockpit layout — min-h-0 flex discipline, category
  rail scroll, Balance/Hold dedup into navbar, empty-cart checkout guard,
  high-contrast DLC badge. Layout-only; no fiscal/DAL/licensing touched.
- ADR-006-MKT (2026-10-27): inventory_losses ledger (6-reason CHECK, RESTRICT,
  BEGIN IMMEDIATE atomic write-off) + expiry radar query + 3 REST endpoints.
- ADR-005-MKT (2026-10-27): cash cockpit — centimes tender engine + smart DA presets;
  F1-F4/Alt+1-4 capture matrix, Enter-empty=exact, text-5xl change, z-70 Change HUD
  with scanner/Enter/Space/Esc dismiss + barcode re-arm; F12 cockpit entry.
- ADR-003-MKT (2026-10-27): universal scale parser (20/21/22/28/29, EAN-13 gate).
- ADR-004-MKT (2026-10-27): product_barcodes (alias x1 / pack xN + override);
  scan priority scale → primary → alias → fuzzy; pack-aware qty_milli drain.
