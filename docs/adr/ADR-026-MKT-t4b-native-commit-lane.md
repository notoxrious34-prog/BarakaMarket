# ADR-026-MKT — T4b: Native Prod Commit Lane (`record_sale` / `record_settlement`)

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.1
**Implements:** PROGRAM-BLUEPRINT-v2.0 T4b (exe ships no loopback; checkout
must stay fully fiscal inside the Tauri shell).

## Decision
1. New `src-tauri/src/fiscal.rs` (~580 lines): rusqlite edition of the TS
   DAL invariants. `record_sale` / `record_settlement` RE-VALIDATE every
   money invariant (integer centimes, TVA ∈ {0,9,19}, HT+TVA+timbre=TTC,
   tier sums, Art.136 timbre vs the DB's own `store_profile`), then own
   seq (`BEGIN IMMEDIATE` + `UPDATE…RETURNING`) + idempotency + atomic
   commit. Unknown `product_id`s NULL the FK (exe lane carries barcode/name
   truth); matched rows drain stock exactly like the TS lane.
2. `migrate()` in Rust converges any file to v3 (idempotent; dual-lane
   contract with TS `migrateSchemaVersion`). `provision_db` runs it on
   every open — legacy shop files climb automatically.
3. Frontend `commitSale` / `commitSettlement`: invoke-first, loopback
   fallback, null last. Inside the shell a Rust refusal returns null
   directly (never silently downgrades to loopback). `mintRowId()` gives
   both lanes one row identity (TS adopts a provided id).
4. Tests: 4 Rust unit tests (commit+dedupe, invariant rejection with zero
   rows, settlement dedupe+balance, v1→v3 climb on a faithful legacy DDL)
   + 4 TS commit-lane tests (fallback, id forwarding, down→null).

## Evidence (TDD: 3 real bugs caught)
- Rust: tuple-destructure typing, tx/conn borrow, `?29`+literal
  off-by-one in the sales INSERT (33 values/32 cols), `buy_price_ct` seed.
- `DROP COLUMN` simulation failed on bundled SQLite (`incomplete input`)
  → replaced with a faithful v1 DDL (production legacy files never had
  the columns; DROP was only the simulation's artifact).
- `cargo test 4/4` · `cargo check` clean · contract grep identical on
  both sides · TS suite **219/219** · `tsc` clean.

## Consequences
The exe is fiscally autonomous: FACT/T/Q + timbre + idempotency hold with
no loopback process. Dev/browser keep the loopback lane untouched.
T4c next: product/stock truth unification (upsert/list/search via invoke).
