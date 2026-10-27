# ADR-011-MKT: Supplier BL Receiving & Atomic Stock Influx

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Phase 3 opens with purchases: distributors deliver against BLs/factures, but
no DAL workflow turned a slip into stock, cost and debt. The task sketch
assumed columns that do not exist (`balance_ct`, `doc_ref`, `price_ct`,
`updated_at`, `supplier_payments.purchase_id`) — the real schema centers on
HT/TVA/TTC purchase headers linked by TEXT UUIDs.

## Decision

1. **Model (adapted):** items carry HT `unitCostCt` per base unit + optional
   `tvaRate` (default: product's rate) + optional `updateSellPriceCt`;
   `totalCostCt` is cross-checked, not trusted. Line TVA rounds half-up in
   integers. `paidAmountCt > total` is rejected (no supplier overpayment
   state). Fully-paid purchases store the cash method; credit purchases
   store `CREDIT` (matching the `purchases.payment_method` CHECK).
2. **Atomicity:** one `BEGIN IMMEDIATE` — header (`invoiceRef` or generated
   `BL-YYYY-XXXXXXXX`), item rows (qty `packs×mult×1000`, buy HT, sell TTC),
   product `stock_milli` influx + `buy_price_ct` refresh (+optional sell
   refresh, no `updated_at` — column absent), optional `supplier_payments`
   row, `suppliers.balance_due_ct` bump. Any failure → ROLLBACK.
   `DeliveryReceiptResult.purchaseId` is the TEXT UUID (spec's `number`
   adapted — purchases PK is TEXT).
3. **Queries:** `getSupplierPurchases` (newest-first, limit-guarded),
   `getSupplierBalanceStatement` (`SUM(total_ttc)` vs `SUM(payments)` vs
   live `balance_due_ct` — three-way cross-checkable).
4. **REST:** `POST /api/purchases/receive` (201), `GET
   /api/suppliers/:id/purchases`, `GET /api/suppliers/:id/statement`.

## Consequences

* Positive: BL → shelf in one atomic call; debt exact in centimes;
   isolation verified per supplier; 135/135.
* Accepted: purchase numbering is UUID + human `invoice_number` (no fiscal
   seq — seq kinds cover sales/quittances only); UI receiving screen is a
   later DSN task.
