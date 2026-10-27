# ADR-014-MKT: Manager Override PIN Gate & Void Audit

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Phase 4 needs internal-fraud control: line voids, cart clears, manual
discounts and drawer kicks must pass a manager PIN, and every approval must
land in an append-only journal the owner can audit. The existing `void_log`
only carried sale voids (`sale_id`, `invoice_number` NOT NULL).

## Decision

1. **PIN gate:** `security.ts` — `SHA-256(salt + ':' + PIN)` verifiers
   (`saltHex:hashHex`, per-PIN random salt), constant-time `safeEqual`,
   4–8 digit format rule, default `1234` fallback when no hash is stored.
   Hash lives in `meta.manager_pin_hash`; DAL exposes
   `setManagerPin` / `verifyManagerPinDb`.
2. **Journal:** `void_log` gains nullable audit columns (`action_type`,
   `product_id/name`, `amount_ct`, `cashier/manager_name`, `session_id`,
   `created_at`) via schema rewrite (fresh DBs) + migration ALTERs
   (existing DBs); `sale_id`/`invoice_number` relaxed to nullable so
   override events and sale voids share one table. INTEGER PK kept —
   record ids surface as strings. Override queries filter
   `action_type IS NOT NULL`, so legacy sale voids never pollute the audit.
3. **Bridge:** `manager-override.ts` — all four actions unconditionally
   gated; `buildVoidLogEntry` validates shape (integer amount ≥ 0,
   non-empty cashier + reason) into the auditable entry.
4. **REST:** `verify-pin`, `set-pin` (403 on wrong current, 400 on bad
   format), `void-log` POST (201) / GET (filters), `void-summary`
   (global or per-session).

## Consequences

* Positive: fraud-sensitive actions logged in centimes with manager
   attribution; sale-void flow regression-tested untouched; 177/177.
* Accepted: `sale_id`/`invoice_number` nullable (was NOT NULL — DAL still
   always writes them for sale voids); record `id` is TEXT-mapped rowid
   (spec asked TEXT PK; SQLite AUTOINCREMENT kept for the legal journal).
