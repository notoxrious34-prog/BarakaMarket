# TEST REPORT — Baraka Market v1.0.0-GA
Date: 2026-10-27 · Commit: `fd23dd7` (tag `v1.0.0`) · Runner: `npm run test:all` (tsx --test, node:test) · `npm run lint` (tsc --noEmit) · `npm run build` (vite)

| Suite | File | Tests | Result |
|---|---|---|---|
| Centimes engine | src/core/fiscal.centimes.test.ts | 18 | ✅ 18/18 |
| UI bridge parity (grid + golden) | src/core/cart-bridge.test.ts | 2 | ✅ 2/2 |
| Settlement fiscal (Art.136) | src/core/settlement.fiscal.test.ts | 4 | ✅ 4/4 |
| Licensing (Ed25519) + SHA-256 cross-check | src/core/licensing.test.ts | 13 | ✅ 13/13 |
| Z-report chain | src/core/zreport.test.ts | 4 | ✅ 4/4 |
| ESC/POS buffers | src/hardware/escpos.test.ts | 3 | ✅ 3/3 |
| Scanner burst + scale | src/hardware/scanner.test.ts | 5 | ✅ 5/5 |
| Synthesized audio | src/hardware/sound.test.ts | 2 | ✅ 2/2 |
| Legacy accounting (no regression) | src/utils/accounting.test.ts | 2 | ✅ 2/2 |
| SQLite WAL layer + colisage DAL | src/db/sqlite.test.ts | 14 | ✅ 14/14 |
| Z-report persistence | src/db/zreport.test.ts | 2 | ✅ 2/2 |
| Live API (loopback + raw-print) | server/index.test.ts | 5 | ✅ 5/5 |
| Colisage math (pure) | src/core/colisage.test.ts | 5 | ✅ 5/5 |
| Cash tender math (pure) | src/core/cash-tender.test.ts | 8 | ✅ 8/8 |
| Loss ledger + expiry radar | src/db/loss.test.ts | 9 | ✅ 9/9 |
| **Total** | **15 files** | **96** | **✅ 96/96, 0 fail** |

- `tsc --noEmit`: EXIT 0, empty log.
- `vite build`: success, `dist/` 1.6MB (< 2.5MB gate), zero warnings.
- Gate floor: must never regress below 58/58 (Constitution v2-MKT §4) — 96/96 holds.
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
