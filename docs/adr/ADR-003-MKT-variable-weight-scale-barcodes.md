# ADR-003-MKT: Universal Variable-Weight Scale Barcodes

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

In-store scales (Dibal, Bizerba, DIGI) emit EAN-13 labels `PP IIIII VVVVV C`.
The engine only recognised prefixes 20/22 — and worse, the matcher regex was
`/^(20|22)(\\d{5})…/` (double-escaped `\\d`: matches a literal backslash, so
the scale branch was **dead code** — labels silently fell through to fuzzy
lookup). Real counters use 20/21 (weight), 22/29 (price), and 28 (house label).

## Decision

1. `isValidEan13` (GS1 mod-10) gates ALL scale parsing; corrupted reads return
   `isScale:false` and fall through to the standard exact-barcode lookup.
2. Prefixes `20/21/22/28/29`; WEIGHT for 20/21/28-default (`VVVVV` grams =
   `qty_milli`, 1 g = 1 milli-unit); PRICE for 22/29 and 28-with-flag
   (`VVVVV` whole dinars → `priceCt = V × 100`, documented integer rule).
3. Cart keeps kg-float quantities; PRICE labels back-calculate
   `qtyMilli = round(priceCt·1000 / unitCt)` so the line reproduces the label
   (±1 ct rounding accepted and tested).
4. Lookup order: `scale_item_code == IIIII` → `== String(rawNumericCode)` →
   exact `barcode == full scan`.

## Consequences

* Positive: Dibal/Bizerba/DIGI labels scan first-try; dead regex removed;
  10 new tests (18 in file, 70 total).
* Accepted: dinar-vs-centime ambiguity resolved by convention (documented on
  the ticket and in training); price labels on zero-price PLUs fall back to
  qty 1 (flagged in UI message).
