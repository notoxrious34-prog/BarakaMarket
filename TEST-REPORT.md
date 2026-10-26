# TEST REPORT — Baraka Market v1.0-rc1
Date: 2026-10-26 · Runner: `npm run test:all` (tsx --test, node:test) · `npm run lint` (tsc --noEmit) · `npm run build` (vite)

| Suite | File | Tests | Result |
|---|---|---|---|
| Centimes engine | src/core/fiscal.centimes.test.ts | 9 | ✅ 9/9 |
| UI bridge parity (144-combo grid + golden) | src/core/cart-bridge.test.ts | 2 | ✅ 2/2 |
| Legacy fiscal (no regression) | src/utils/fiscal.test.ts | 6 | ✅ 6/6 |
| Legacy accounting (no regression) | src/utils/accounting.test.ts | 2 | ✅ 2/2 |
| SQLite WAL layer | src/db/sqlite.test.ts | 10 | ✅ 10/10 |
| Live API (ephemeral port) | server/index.test.ts | 4 | ✅ 4/4 |
| **Total** | | **33** | **✅ 33/33, 0 fail** |

- `tsc --noEmit`: EXIT 0, empty log.
- `vite build`: success, `dist/` (JS ~420KB / CSS ~53KB), zero warnings (native `__dirname` warning fixed via `import.meta.dirname`).
- Cross-validation new-vs-legacy engine (72 combos): max divergence 1ct (rounding order only).
- Migration dry-run: 12/4/5 + 1 sale/4 items, `lines_adjusted_1ct: 0`, `timbre_diffs: 0`.
- Bench (`npm run bench`): line 0.0003ms · 4-line sale 0.0006ms · seq-next 0.0685ms → verdict PASS vs 150ms budget.
