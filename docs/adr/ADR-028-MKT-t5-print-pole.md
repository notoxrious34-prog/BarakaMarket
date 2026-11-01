# ADR-028-MKT — T5: Pro Printing + Customer Pole Display

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.1
**Implements:** PROGRAM-BLUEPRINT-v2.0 T5.

## Decision
1. New `src/hardware/pole-display.ts`: 2×20 VFD compiler for the common
   auto-wrap class (CLR + 20 + CR + 20, brightness `ESC * n`). Portable
   subset only — no hardware-specific cursor codes. Welcome / total /
   tendered / thanks frames, Latin-folded, 20-col exact.
2. New `src/core/print-lane.ts`: ONE entry point. Lane A (hardware) =
   compiled ESC/POS → loopback spool with token; Lane B (CSS modal print,
   .bin download) untouched and instant. Every function resolves
   false/null instead of throwing — print NEVER blocks a sale.
3. `/api/raw-print` splits streams by label prefix: `pole*` →
   `pole-display-spool.bin`, else `raw-print-spool.bin` (one forwarder
   each, no framing needed). Token gate unchanged (401 proven in T4).
4. Wiring (fire-and-forget): payment modal open → pole total due;
   authoritative commit → ticket auto-spool (drawer kicks on ESPECES
   only) + pole tendered frame.

## Evidence
- 6 pole tests + 5 print-lane tests + 1 spool-routing test — **234/234**.
- Live: ticket 10B → `raw-print-spool.bin`, pole 21B →
  `pole-display-spool.bin`, `bytes` reconcile, files cleaned after.

## Consequences
Checkout is now a two-screen act (cashier + customer) with zero new
failure modes. T6 next: RS-232 scale (parser already exists —
`parseScaleBarcodeCt`; needs the serial lane + weight-stable capture).
