# ADR-034-MKT — T11: soak/keyboard/triggers

- Status: ACCEPTED 2026-11-01 (T11 DONE — triggers 3+2, login keys, soak green).
- Updates: none (new record).
- Related: PROGRAM-BLUEPRINT-v2.0 T11, §11 shop-ready definition.

## Context

Three half-promises stood between the till and the shop floor: (1) nothing at
the storage layer stopped raw SQL from rewriting history; (2) the lock screen
was mouse-only, breaking Zero-Mouse at the very first step; (3) no sustained
load had ever proven the seq lanes gapless under volume.

## Decision

1. **Triggers — append-only + terminal-state, in all three DDL homes.**
   Seven guards (`schema.sql` tail for fresh files, `v4→v5` migration step for
   legacy files, mirrored in `fiscal.rs`): no DELETE on sales / sale_items /
   client_settlements / users / audit_log, no UPDATE on audit_log, no
   resurrection of CANCELLED. `LATEST_SCHEMA_VERSION = 5` both lanes.
   Application code already honors these — triggers are the last line even
   raw SQL cannot cross. Tests: DAL 3, Rust 2 (incl. legacy-file climb → v5
   with triggers restored).
2. **Keyboard — login parity + audited map.** `LoginScreen` gains digits /
   Backspace / Enter / Escape (T11 gap, now closed). `docs/KEYBOARD-MAP.md`
   records the full matrix audited FROM code (POS F1–F12, payment matrix,
   lock screen) with the shop rule: no keyboard-less flow ships enabled.
3. **Soak — `npm run soak` (default 500 sales + 200 settlements + 50 voids**
   on a file-backed WAL DB). Asserts gapless FACT/T/Q, centime-exact active
   totals, triggers still armed. Live result: green, 0.83ms/sale
   (180x inside the 150ms budget), db 600KB / wal 4MB after 750 commits.
   The 8h real-cashier soak stays a T12 exit step — this is its mechanical
   equivalent, and it already caught two real bugs (script-side ORDER BY on
   text ids; hardcoded TTC ignoring the timbre bracket) before they could
   become shop-floor surprises.

## Consequences

- Storage now enforces what the app promises: history is write-once.
- Every flow from PIN to printed ticket is keyboard-drivable and documented.
- `npm run soak` is the pre-release load gate; T12 runs it before the build.
