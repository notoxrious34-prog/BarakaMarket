# ADR-010-MKT: Shelf-Edge Label Engine

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

DCP mandates shelf-edge pricing; shops lack label printers. Two lanes are
needed: A4 perforated sheets (office printer) and continuous 80mm thermal
strips (existing receipt printer). Barcodes must be vector (laser-crisp),
generated with zero dependencies.

## Decision

1. **`barcode-svg.ts` (zero-dep GS1):** L/G/R tables + first-digit parity
   map; `normalizeEan13` accepts 12 digits (computes key) or 13 (verifies,
   throws on mismatch); `ean13BitPattern` exposes the 113-module pattern
   (quiet 9 + guards at 9/54/101); `generateEan13Svg` merges black runs
   into rects, guards rendered taller (+8px), optional human-readable text.
2. **`shelf-labels.ts`:** `ShelfLabelItem` canonical; A4 = standalone HTML
   (`@page A4/8mm`, 3-col grid, 65×38mm cards, dashed cut borders, inline
   SVG, TVA badge, scale-code line, HTML-escaped names); thermal = raw
   ESC/POS (`ESC @`, center, `ESC ! 32` name, `ESC ! 48` giant
   `*** 450.00 DA ***`, TVA/rayon line, barcode digits, `[CODE BALANCE]`,
   dashed scissor line + `ESC d 2` per label, `GS V B 0` cut at end).
   Thermal text folded to 7-bit (local `foldLatin`, deterministic).
3. **Server:** `POST /api/labels/preview-html` and `/api/labels/print-thermal`
   (`{productIds, storeName?}`); rows mapped DAL→label (inline TVA guard —
   `sqlite.ts` untouched); thermal bytes appended to the same
   `raw-print-spool.bin` lane as `/api/raw-print`.
4. **Types:** canonical in `shelf-labels.ts`, re-exported from `src/types`.

## Consequences

* Positive: DCP-ready shelf tags from either printer; mathematically valid
   GS1 patterns (guard offsets unit-tested); 118/118.
* Accepted: server maps by product id (no ad-hoc label composer UI — a
   later DSN task can add batch selection).
