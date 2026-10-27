# ADR-013-MKT: Cash Sessions & Thermal Z-Report Engine

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Phase 4 needs shift discipline: opening float, mid-day drawer movements,
counted-close reconciliation and a fiscal Z that locks the period. The Z
table is hash-chained (`finalizeZReport`), so the closure must extend that
chain — never insert a parallel Z row.

## Decision

1. **Schema:** `cash_sessions` (UUID, cashier, opened/closed, float,
   counted, theoretical, diff, OPEN/CLOSED, `z_report_id → z_reports`) +
   `cash_movements` (DEPOSIT/WITHDRAWAL/EXPENSE, `amount_ct > 0`, CASCADE),
   appended to `db/schema.sql` (executed wholesale by `openBarakaDb`,
   hence idempotent).
2. **DAL:** single OPEN session enforced; `getCashSessionStatus` computes
   live theoretical = float + ESPECES sales (TTC) + ESPECES settlement
   collections (incl. timbre, physical cash) + deposits − withdrawals −
   expenses, all in window `[opened_at, now-or-closed_at]`.
   `closeCashSessionAndGenerateZ` runs one `BEGIN IMMEDIATE`: aggregate
   sales/settlements/movements, theoretical + diff, then the exact
   `finalizeZReport` statements (prev-hash lookup, `Z-YYYY-XXXXXX` seq,
   `computeZHashDb`, full-column INSERT) inside the txn, then CLOSE the
   session with the Z link. Any failure → ROLLBACK.
3. **Ticket:** `buildThermalZReport` (turnover, TVA 9/19, timbre when > 0,
   tender split incl. CIB lane, drawer reconciliation with
   DEFICIT/EXCEDENT/PARFAIT verdict, hash tail, feed + cut) reusing ESC/POS
   consts; no drawer kick (close-out, not cash-in — kick stays on
   sale/settlement buffers).
4. **REST:** `POST /api/cash/open` (201, double-open 400),
   `POST /api/cash/movement` (201), `GET /api/cash/active` (null when
   none), `POST /api/cash/close-and-z` (201, spools unless
   `printReceipt === false`).

## Consequences

* Positive: gapless Z chain preserved (chain verified across shifts in
   tests); drawer math exact in centimes; 162/162.
* Accepted: result carries `cibSalesCt` + `hash/prevHash` beyond the
   sketch (real tender set + chain audit); close-out ticket omits the
   kick pulse deliberately; `sales` aggregates use `timbre_ct` /
   `created_at` (real columns).
