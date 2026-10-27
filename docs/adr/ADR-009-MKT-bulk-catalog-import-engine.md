# ADR-009-MKT: Bulk Catalog Import Engine

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Catalogs of 5k–30k SKUs arrive as supplier CSVs (Algerian lists use `;`,
French tools export `,`, headers mix FR/EN). Manual entry is not viable;
the engine had no bulk path. Parser must be dependency-free, money exact,
and dry-runnable before any write.

## Decision

1. **Parser (`csv-importer.ts`, zero deps):** first-line `;`-vs-`,` count
   (quote-aware); hand-rolled RFC-4180 splitter (doubled quotes, CRLF in
   quotes); FR/EN header aliases incl. `name_fr`/`name_ar` split; Dinars→ct
   via `dzdToCentimes`, qty→milli `round(v×1000)`; decimal commas accepted
   under `;` delimiter; trailing `%` on TVA tolerated; defaults
   TVA 0 / stock 0 / PIECE / `Général`.
2. **Preflight:** per-row `{row, field, message}` errors — empty barcode,
   in-file duplicates, negative/non-numeric prices, TVA ∉ {0,9,19}, bad
   stock/unit; missing barcode column aborts. Returns
   `{validRows, errors, summary}` — never touches the DB.
3. **DAL (`importProductsBatch`):** single `BEGIN IMMEDIATE`; per-row guard
   (tva/unit/integer/non-negative); UPSERT inserts or merges
   (`stock_milli` adds, price refreshes, counted via pre-check);
   INSERT_ONLY uses `INSERT OR IGNORE` (dupes → `failed`); UPSERT errors
   abort the whole batch (ROLLBACK), INSERT_ONLY skips. Mapped to the real
   schema (`sell_price_ct`, `name_fr`, `category_id`) — the task sketch's
   `price_ct`/`updated_at` columns do not exist.
4. **REST:** `POST /api/products/import-preview` (`{csvText}` →
   summary + 10-row preview + errors), `POST /api/products/import-execute`
   (`{rows, mode?}` → `{success, inserted, updated, failed}`).
5. **Types:** `ImportProductRow`/`BatchImportResult` live in `src/types`
   (server + DAL share them).

## Consequences

* Positive: 30k-row dry-runs in milliseconds; atomic commits; no new
  dependencies (`package.json` untouched).
* Accepted: pre-check SELECT per UPSERT row (correctness over raw speed);
  decimal-comma conversion only under `;` (`,`-delimited decimals stay
  invalid rather than ambiguous).
