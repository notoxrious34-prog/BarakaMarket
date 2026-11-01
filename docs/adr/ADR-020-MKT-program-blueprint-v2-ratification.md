# ADR-020-MKT: Program Blueprint v2.0 Ratification (Rebuild Without Demolition)

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.0
**Ratifies:** `docs/architecture/PROGRAM-BLUEPRINT-v2.0.md` (supersedes
`docs/ROADMAP.md` Oct-26 era) · **Owner-approved:** pole design-in, T1→T12,
GitHub+USB updates, single till, zero-cloud absolute, full RBAC, pro printing.

## Context
Deep audit (195/195 green, 22 tables, lane tracing) proved the engine house
solid but found the one shop-blocking gap: POS checkout commits to
localStorage only (`PosView`/`PaymentModal` issue zero `/api/sales` calls)
while the SQLite/server lane serves everything around the sale. The program
is complete everywhere except the sale-commit moment.

## Decision
1. Adopt PROGRAM-BLUEPRINT-v2.0 as the single active plan (keep/fix/add,
   §2–§4), with the evolvability contract (§9) binding on all future work.
2. Owner scope locks (§1): pole display designed-in (T5), updater dual-path
   (T9), single poste, cloud absolutely out, RBAC full (T8), printing full (T5).
3. Execution order: T1 → T2 → T3 → T4 → T8 → T9 → T10 → T11 → T5/T6/T7
   (hardware-bound, whenever devices arrive) → T12. Order flexible per owner.

## Consequences
- T1 redefines "done" for every later task: no feature is complete until its
  writes land in the WAL lane (or the documented offline queue).
- `docs/ROADMAP.md` retained as historical; Blueprint v2.0 is normative.

## Invariants preserved
All 7 charter laws untouched; no fiscal/schema/licensing change in this ADR
(docs only).
