# ADR-005-MKT: Fast Checkout & Cash Tender Cockpit

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

90%+ of Algerian supermarket volume settles in ESPECES (500/1000/2000 notes)
under queue pressure. The cockpit used float `changeDue`, a generic
denomination list, bubble-phase shortcuts that collided with the POS F1-F4
layer, and no change splash — cashiers read small change figures and
re-focused the barcode manually.

## Decision

1. **Engine:** `calculateCashChange(totalTtcCt, tenderedCt)` and
   `smartCashPresetsCt` in `fiscal.centimes.ts` — pure integer centimes
   (`{changeCt, isValid, deficitCt}`; presets = exact + 500/1000/2000
   thresholds + next ×1000 + next ×2000 + 5000, deduped ascending).
2. **Cockpit:** autofocus+select tender input; smart chips incl. Exact-F1;
   live emerald `text-5xl` change or rose deficit box; capture-phase matrix
   (F1-F4/Alt+1-4, Enter finalizes — empty = exact, Esc cancels) with
   stopPropagation against POS F-layer; `1/2/3` dropped (Alt+1 conflict),
   tender select stays on `2/3` clicks.
3. **Flow:** same commit/kick/chime path; cash sales raise a z-[70]
   **Change HUD** (À RENDRE `text-6xl`) above the print ticket — any
   Enter/Space/Escape/scanner char/click dismisses it, closes the cockpit,
   and PosView's `onClose` re-arms the barcode input for the next client.
4. **F12** opens the cockpit from the POS grid (Space/F9 unchanged).

## Consequences

* Positive: sub-second exact-amount sales (open → Enter → Enter → next);
  change readable at arm's length; zero regression (87/87).
* Accepted: HUD sits above the 80mm ticket preview until dismissed;
  tendered input stays a DZD text field, converted at exactly one choke
  point (`dzdToCentimes`) before any fiscal math.
