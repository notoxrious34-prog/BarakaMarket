# ADR-024-MKT: T2b — Settlement Lane Single-Lane (Q via Server seq)

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.1
**Implements:** Blueprint T2b (approved scope addition: settlement lane was
100% browser-local — no UI ever called `/api/settlements`).

## Context
Debt-settlement quittances minted `Q-YYYY-######` in the browser while the
server owned a parallel Q `seq` — the same dual-numbering fork T2 closed for
sales. Worse, lane analysis showed the UI never POSTed settlements at all.

## Decision
Same T1 pattern, second lane:
1. Server: `client_settlements.client_settlement_key` (v2→v3 migration,
   partial unique index via migrator — never schema.sql), idempotent
   `recordSettlement` (pre-check + UNIQUE-race net) + atomicity fix: the
   UPDATE+INSERT now run in `BEGIN IMMEDIATE` (previously autocommit halves).
   `CLIENT_NOT_FOUND` is now an error (ghost-client settlements are a defect).
2. Client: `postSettlementToLoopback` → `/api/settlements`; `settleClientDebt`
   is async, mints one key, POSTs when fiscal, else provisional `DRAFT-Q-<ts>`
   + outbox kind `'settlement'`; drain upgrades receipt rows by kind.
3. Outbox generalized: `kind: 'sale' | 'settlement'` (pre-kind T1 entries
   load as sale), replay routes by kind, receipts carry receipt_number.
4. Guard: browser mints no Q; `DRAFT-Q-` marker present (browser-lane.test).

## Evidence (TDD RED → GREEN + live wire)
- New: 3 idempotency tests (dedupe · sequential Q · v0→v3 migration) —
  RED 0/3 (incl. a real bug: my timbre fixture ignored the 10-DZD ceil floor;
  engine was right, fixture fixed) → GREEN.
- New: 2 outbox tests (kind routing · backward compat).
- Live loopback: `WIRE-ST-1 → Q-2026-000001`, retry → SAME-RECEIPT,
  `WIRE-ST-2 → Q-2026-000002`.
- Gates: `tsc` clean · **214/214** (208 + 6).

## Consequences
All three fiscal numbers (FACT/T/Q) now come from exactly one source: the
SQLite `seq`. T2 COMPLETE (sale lane ADR-023 + settlement lane here).
