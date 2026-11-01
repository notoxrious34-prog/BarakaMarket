# ADR-023-MKT: T2 — Single-Lane Numbering (Sale Lane)

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.1
**Implements:** PROGRAM-BLUEPRINT-v2.0 T2 (sale lane). Builds on ADR-021/022.

## Context
With the outbox upgrading provisional rows, the last fork risk was the
browser minting REAL-looking `FACT-YYYY-######` / `T-YYYY-######` numbers.
A degraded-mode ticket could then carry a number the SQLite `seq` later
reassigned to another sale — two paper documents, one fiscal identity.

## Decision
1. `completeSale` provisional rows now carry `DRAFT-FACT-<ts36>` /
   `DRAFT-T-<ts36>` — unique per finalize, obviously non-fiscal, greppable.
   The outbox drain replaces them with authoritative numbers (unchanged path).
2. `nextBrowserSeq('FACT'/'T')` calls deleted; `test:all` extended with
   `src/context/*.test.ts`.
3. New guard `src/context/browser-lane.test.ts` (3 tests): no FACT/T minting
   in browser source · DRAFT markers present · no `sales.length` numbering
   (comment-aware, CRLF-safe). TDD: 0/3 RED on pre-T2 source → 3/3 GREEN.
4. SCOPE NOTE: `nextBrowserSeq('Q')` (debt-settlement receipts) stays — the
   settlement lane is 100% browser-local today (no UI calls
   `/api/settlements`). Wiring it to the server seq is proposed as **T2b**
   (same T1 pattern: idempotency + UI POST + upgrade), queued after T4.

## Evidence
- Gates: `tsc` clean · **208/208** (205 + 3) · build unaffected.

## Consequences
No paper or screen can ever show a browser-minted FACT/T again. The `seq`
table is the sole source of fiscal identity for the sale lane.
