# ADR-006-MKT: Expiry Tracking & Inventory Loss Ledger

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Phase 2 opens with perishables control: DCP fraud inspections punish expired
shelf stock, and breakage/spoilage ("La Casse") had no ledger — only generic
`has_expiry/expiry_date` columns with no write-off path or surveillance query.

## Decision

1. **Schema:** `inventory_losses(id INTEGER PK, product_id→products RESTRICT,
   qty_milli > 0, reason ∈ 6-way CHECK, unit_cost_ct/total_loss_ct ≥ 0,
   notes, created_at)` + product/created indexes + partial
   `idx_products_expiry WHERE has_expiry = 1`. INTEGER ids match the repo's
   `products(id INTEGER)` (the task sketch's TEXT ids were adapted).
   `schema.sql` re-runs on every open, so existing DBs self-provision.
2. **DAL:** `recordInventoryLoss` under `BEGIN IMMEDIATE` — reason guard,
   positive-integer qty, stock-sufficiency check, ledger INSERT + stock
   decrement, COMMIT/ROLLBACK; returns `{id, stock_milli}`. `total_loss_ct`
   defaults to `round(unit_cost × qty/1000)`, overridable (e.g. partial value).
   `getInventoryLosses({reason, product_id, from, to, limit})` newest-first.
   `getExpiringProducts(days)` — `date(expiry) ≤ date('now','+N days')`, ASC.
3. **REST:** `POST /api/losses` (201), `GET /api/losses` (filters),
   `GET /api/perishables/expiring?days=7` — same 400-on-error style.
4. **Types:** `LossReason` + `InventoryLoss` in `src/types` (imported by DAL
   and server; no `as never` casts).

## Consequences

* Positive: every casse/démarque is an immutable, timestamped row with cost;
   RESTRICT preserves audit chain; expiry radar is one indexed query.
* Accepted: over-stock losses throw (no negative stock); UI surfacing
   (stock view badges) is a later DSN task — DAL + API are ready.
