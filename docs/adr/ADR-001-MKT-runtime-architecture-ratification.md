# ADR-001-MKT: Ratification of Baraka Market Runtime Architecture & Baseline

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect (ratified); Executor: Muse Spark 1.3 Contributor
* **Scope:** `D:\Dev\baraka-market` @ `fd23dd7` (tag `v1.0.0`)

## Context

TASK-AUD-001-MKT performed a strict read-only forensic audit of the workspace:
Tauri v2 shell (single `db_status` command, schema embedded at compile time),
React 19 + TypeScript strict + Vite 8 + Tailwind v4 frontend, dual SQLite lanes
(rusqlite 0.32 bundled native / node:sqlite loopback on `127.0.0.1:3100`),
WAL + foreign_keys enforced, money as integer centimes, quantities as integer
milli-units, deterministic ESC/POS byte builders with drawer kick, HID burst
scanner trap, SHA-256 Z-report hash chain, HMAC-based air-gapped licensing —
with **58/58 tests passing, lint clean, 1.6 MB bundle**. Gaps found: scale
prefixes 21/28/29, multi-barcode, colisage, pole display, serial scale, no DB
triggers, no versioned migrations, unauthenticated loopback port, stale
doc headers.

## Decision

Ratify the audited stack verbatim as the official foundation under Charter
v2.0-MKT and `CONSTITUTION_OF_EXECUTOR.md`. Pursue **incremental enhancement
only** — no engine rewrites. Missing supermarket capabilities (multi-barcode,
packaging/colisage, remaining scale prefixes, pole display, loopback auth
token) enter the backlog as tracked `TASK-DSN-*` items. Stale headers
(Cargo description, main.rs comment, TEST-REPORT counts) are reconciled in the
same change.

## Consequences

* **Positive:** maximum execution speed on a verified base; fiscal invariants
  already engine-enforced (CHECKs, integer guards, hash chains).
* **Negative:** trigger-level ledger enforcement and migration versioning remain
  absent — accepted risk, mitigated by app-level guards + idempotent open logic.
* **Gates apply immediately:** `npm run test:all` ≥ 58/58, lint 0, build < 2.5 MB.
