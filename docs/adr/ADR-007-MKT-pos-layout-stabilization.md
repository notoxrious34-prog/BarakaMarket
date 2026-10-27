# ADR-007-MKT: POS Cockpit Layout Stabilization

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Visual audit of the running cockpit found: row-3 product cards clipped by the
shortcut footer, a horizontally-overflowing category rail with a dead
`no-scrollbar` class, triple-rendered Balance / En-Attente controls, a
bright-active checkout button on an empty cart, and a low-contrast expiry
badge.

## Decision

1. **Flex discipline:** catalog column, grid scroller, cart list and right
   column all carry `min-h-0`; grid scroller is `flex-1 min-h-0
   overflow-y-auto`; shortcut footer and fiscal banner are `flex-shrink-0`.
   Grid steps to `grid-cols-2 md:3 lg:4 xl:5`.
2. **Category rail:** `overflow-x-auto no-scrollbar py-1 flex-shrink-0`, tabs
   `whitespace-nowrap flex-shrink-0`; `.no-scrollbar` is now a real utility
   in `index.css` (it matched nothing before).
3. **Dedup:** search-row Balance button removed (F6 global + footer hint +
   top-bar toggle remain); cart-column Attente/Rappeler pair removed —
   parking consolidates to a new navbar Hold (F4) button + navbar held
   dropdown (F5 restore) + F4/F5 keys.
4. **Empty-cart guard:** checkout button renders slate/disabled when
   `currentCart.length === 0`; `requestCheckout` already no-ops, and F9 /
   F12 / Space handlers now return explicitly before it.
5. **Badge:** `Date courte` is now `bg-rose-600 text-white … uppercase`
   (was rose-950/50 ghost text).

## Consequences

* Positive: zero clipping at 80mm-operator viewports; one park control per
  surface; no dead checkout path; clearance items readable at arm's length.
* Accepted: hold/recall moved to the navbar (one extra click for mouse
  users); layout-only change — no fiscal, DAL, or licensing code touched.
