# ADR-022-MKT: T1 Slice B — Offline Outbox + Idempotent Auto-Replay

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.1
**Implements:** PROGRAM-BLUEPRINT-v2.0 T1 (client half). Builds on ADR-021.

## Context
Slice A made the server idempotent. The browser half still had two holes:
(1) `completeSaleFiscal` minted no key, so retries were unrelated commits;
(2) a failed POST fell back to a provisional row that NEVER reached SQLite —
the sale stayed out of the fiscal lane forever (degraded mode = silent loss).

## Decision
1. New pure module `src/core/sale-outbox.ts` (StorageLike-injected, 6 unit
   tests): `mintSaleKey` · `enqueueOutbox` (cap 200 FIFO) · `replayOutbox`
   (poison entry never blocks the rest, failures persist with attempts+1).
2. `completeSaleFiscal` mints ONE key per finalize, POSTs it in the header,
   and on ANY failure (or absent loopback) completes provisionally AND
   enqueues `{key, provisionalId, header, items}`.
3. `drainOutbox` runs on every `[authority → FISCAL_SQLITE]` transition and
   after each successful commit; replays UPGRADE provisional rows
   (`SALE-<ts>` → authoritative id/FACT/T, `is_provisional: false`) — the
   printed provisional ticket keeps its numbers, the ledger holds exactly one
   authoritative row per key (audit-acceptable degraded behavior).
4. `AuthorityHeaderInput.client_sale_id` added; server route unchanged
   (header object already flows through).

## Evidence (TDD RED → GREEN + live wire)
- `src/core/sale-outbox.test.ts` 6/6 (roundtrip, corrupt store, FIFO cap,
  drain receipts, poison-entry isolation).
- Live loopback probe (temp DB :3299): `WIRE-1 → FACT-2026-000001`,
  retry `WIRE-1 → SAME-ROW`, `WIRE-2 → FACT-2026-000002`.
- Gates: `tsc` clean · **205/205** (199 + 6).

## Consequences
T1 COMPLETE: every checkout lands in SQLite exactly once — online at once,
degraded via outbox+upgrade. T2 (single-lane seq) now unblocks: browser
`nextBrowserSeq` becomes display-only until removal.
