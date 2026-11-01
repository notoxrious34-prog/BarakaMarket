# ADR-030-MKT — T7: Power-Cut Drill (Real Kill, Real Recovery)

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.1
**Implements:** PROGRAM-BLUEPRINT-v2.0 T7.

## Decision
`src/db/powercut-drill.test.ts` kills a real child process mid-commit
(`BEGIN IMMEDIATE` + partial sale row + seq bump to 41, lock held) and
proves the four crash invariants against the same WAL file:
1. **Isolation** — a second connection sees 0 uncommitted rows.
2. **No silent corruption** — committing under the dead writer's lock
   throws `SQLITE_BUSY` instead of merging.
3. **Clean recovery** — after SIGKILL the next open finds no partial row
   and an unconsumed seq; the first real sale is `FACT-2026-000001`.
4. **Replay-once** — a file-backed outbox (the disk survivor) replays
   exactly one row across the "restart"; a duplicate retry after an
   unclean shutdown still commits once (T1 key).
No new production code was needed: the drill verifies the architecture
(WAL + `BEGIN IMMEDIATE` + idempotency keys + on-disk outbox) rather
than adding to it.

## Evidence
- 2 drill tests GREEN (191ms kill-test, 39ms replay-test).
- Full suite **243/243**, `tsc` clean.

## Consequences
A mid-ticket blackout is now a TESTED scenario, not a hope. T8 next:
full RBAC (cashier/manager/owner + PIN + lock + audit).
