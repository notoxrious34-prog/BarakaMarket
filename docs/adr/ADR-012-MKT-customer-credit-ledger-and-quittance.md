# ADR-012-MKT: Customer Credit Ledger & Thermal Quittance

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Phase 3 needs the Carnet de Dette on rails: the Gate-01 `recordSettlement`
logger wrote fiscal receipts but never touched `clients.credit_balance_ct`,
so the ledger drifted. Shops also need ceiling enforcement and a printed
quittance per settlement.

## Decision

1. **Atomic settlement:** `settleClientCredit` runs `BEGIN IMMEDIATE` —
   fetch client (`CLIENT_NOT_FOUND`), compute Art.136 timbre through the
   existing engine (ESPECES ≥ 50 DZD, CIB/DAHABIYA exempt), decrement
   balance, INSERT `client_settlements` (UUID id, Q-seq `Q-YYYY-XXXXXX`
   receipt, timbre + collected), COMMIT. Any failure → ROLLBACK.
2. **Ceiling gate:** `checkCreditEligibility` projects
   `balance + sale` against `max_credit_limit_ct` (`0` = unlimited);
   breach returns `CREDIT_LIMIT_EXCEEDED` with exact centimes figures.
   `getClientStatement` bundles client + settlements + CREDIT sales.
3. **Quittance:** new `buildThermalSettlementQuittance` (bilingual title,
   `ESC ! 0x10` double-height Versement, conditional timbre line,
   profile-or-string store header, kick + cut) reusing existing ESC/POS
   consts; legacy `buildQuittance` untouched.
4. **REST:** `POST /api/clients/:id/settle` (201),
   `POST /api/clients/:id/settle-and-print` (settles + spools to the
   raw-print lane), `GET /api/clients/:id/statement`.

## Consequences

* Positive: ledger and receipts stay in one transaction; stamp duty
   enforced on cash inflows per INVARIANT 3; 150/150.
* Accepted: payment methods restricted to the fiscal CHECK set
   (ESPECES/CIB/DAHABIYA/CREDIT) — the sketch's VIREMENT/CHEQUE have no
   DB or Art.136 standing; `settlementId` is TEXT (UUID PK); `sales` orders
   by `created_at` (no `date` column); spec's flat `date` field on the
   quittance input adapted to `createdAt` at the print call site.
