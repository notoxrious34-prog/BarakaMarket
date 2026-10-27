# ADR-004-MKT: Multi-Barcode & Multipack Colisage

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Manufacturers rotate EANs across batches and identical SKUs arrive with
different outer labels; shops sell units, packs (x6) and cartons (x12) of the
same parent. The engine accepted exactly one barcode per product and had no
pack concept — pack scans fell through to fuzzy name search.

## Decision

1. **Schema:** `product_barcodes(product_id INTEGER→products, barcode UNIQUE,
   multiplier ≥ 1, pack_name, price_override_ct)` + 2 indexes + FK cascade.
   Ships in `db/schema.sql`; `schema.sql` re-runs on every open, so old DBs
   gain the table idempotently (no ALTER migration needed).
2. **DAL:** `add/get/deleteProductBarcode` + `resolveBarcode` (primary first,
   then alias join) returning `{product, isPack, multiplier, packName,
   effectivePriceCt = override ?? sell_price_ct × N, barcode}`.
3. **POS pipeline:** scale → primary → **alias/pack registry** → fuzzy.
   Pack rows: `quantity` = packs, `unit_price_ttc` = effective price,
   `name_fr += [Pack xN]`, `packMultiplier/packName` carried on the row,
   scanned pack barcode persisted in `sale_items.barcode`.
4. **Stock:** single choke point — commit converts
   `qty_milli = packs × multiplier × 1000` (fiscal lane) and browser lane
   deducts `quantity × multiplier`; `recordSale` itself unchanged (already
   decrements `qty_milli` atomically in-transaction).

## Consequences

* Positive: batch EAN rotations and x6/x12 labels scan first-try; pack price
  overrides (250 DZD vs 6×45) exact in centimes; 9 new tests (79 total).
* Accepted: browser lane trusts the `productBarcodes` localStorage mirror
  (SQLite is authoritative in fiscal lane); pack rows on mixed unit/partial
  discounts keep the pack unit price (documented).
