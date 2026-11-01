# ADR-021-MKT: T1 Slice A — Idempotent Sale Commit + Versioned Migrations

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.0
**Implements:** PROGRAM-BLUEPRINT-v2.0 T1 (server half) + T3 foundation.

## Context
`completeSaleFiscal` already POSTs the centimes payload to `/api/sales` when
the loopback is healthy, but the commit was not idempotent: a retried POST
(double click, dropped connection, outbox replay) consumed a second `seq`
pair, double-drained stock, and double-posted the ledger. No `user_version`
was ever set — schema evolution relied on blind `IF NOT EXISTS` + rescue
ALTERs. (Client half — key minting, outbox, auto-replay — is T1 slice B.)

## Decision
1. `sales.client_sale_id TEXT` (nullable) + partial unique index
   `idx_sales_client_sale_id WHERE client_sale_id IS NOT NULL`.
2. `recordSale` returns the ORIGINAL row when the key already exists
   (pre-check + UNIQUE-race net that returns the winner instead of an error).
   Legacy null-key rows commit exactly as before.
3. `migrateSchemaVersion()` + `LATEST_SCHEMA_VERSION = 2` in `sqlite.ts`;
   every `openBarakaDb` climbs old files step by step, stamps fresh ones.
4. Index-creation lives in the migrator, NEVER in `schema.sql` — two bugs
   proven by RED tests: (a) a bare `CREATE INDEX` in schema.sql crashes the
   open of pre-column files ("no such column"); (b) a `user_version` stamp in
   schema.sql clobbers old versions before the migrator reads them.

## Evidence (TDD RED → GREEN)
- New `src/db/idempotency.test.ts`, 4 tests: same-key retry (1 row, seq ×1,
  stock ×1) · distinct keys (…000001/…000002) · null-key legacy path ·
  v1-file migration (rows intact → v2 → dedupe works).
- Gates: `tsc` clean · **199/199** (195 + 4) · build unaffected (server lane).

## Consequences
- Slice B (client): mint key at finalize, persist payload to outbox on
  failure, replay with the same key, upgrade the provisional row.
- All future schema change = new version step + test. No exceptions.

## Invariants preserved
Centimes-only, pad-6 seq, HT+TVA+timbre=TTC, Art.136 timbre, audit trail —
enforced by the same guards, now idempotent.
