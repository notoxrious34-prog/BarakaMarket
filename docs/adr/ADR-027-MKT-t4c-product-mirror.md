# ADR-027-MKT — T4c: Native Product/Stock Mirror (One-Way)

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.1
**Implements:** PROGRAM-BLUEPRINT-v2.0 T4c (close the fiscal loop: money +
stock both land in SQLite on the exe lane).

## Decision
1. New `src-tauri/src/product.rs`: `product_upsert` (explicit UI id,
   `ON CONFLICT(id) DO UPDATE`; cross-id barcode collisions surface as
   errors), `product_list`, `product_search` (barcode exact-first, 50 cap).
   Same validation discipline as the fiscal lane (integer ct/milli,
   TVA ∈ {0,9,19}, unit set, non-negative money/stock).
2. New `src/core/product-authority.ts`: pure `toNativeProduct` mapping
   (DZD→ct, qty→milli) + `syncCatalogToNative` (invoke-first, stops at
   first refusal) + `list/searchNativeProducts`. Outside Tauri: deliberate
   no-ops (0 / null) — the browser lane is untouched.
3. `AppContext`: one session-guarded effect pushes the UI catalog when the
   authority settles on FISCAL_SQLITE inside the shell. Silent failure by
   design — the sale lane NULLs unknown FKs exactly as before.
4. Scope boundary (honest): the UI keeps READING its own store; SQLite
   holds the fiscal stock mirror. Full two-way merge is ops tooling (T9).

## Evidence
- `cargo test` **7/7** (4 fiscal + 3 product) · `cargo check` clean.
- TS suite **222/222** (+3 product-authority) · `tsc` clean.

## Consequences
On the exe lane every native sale now decrements a MATCHED row: money
truth (T4b) + stock truth (T4c) converge in one WAL. T5 next: pro
printing (raw-print lane already stubbed: spool endpoint + drawer kick).
