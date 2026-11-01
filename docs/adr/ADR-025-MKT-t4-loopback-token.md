# ADR-025-MKT: T4 — Loopback Write Token (Local-Only Auth)

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.1
**Implements:** PROGRAM-BLUEPRINT-v2.0 T4 (charter gap: loopback auth token).

## Context
Every mutating `/api/*` endpoint accepted unauthenticated localhost writes —
any local process could mint FACT/T/Q numbers. The charter demanded a token.

## Decision
1. Server: `ensureLoopbackToken(dbDir)` mints stable 256-bit hex at
   `<dbDir>/.loopback.token` (0600, first boot only; delete to rotate).
   Middleware: all non-GET `/api/*` require `x-baraka-loopback`; GETs stay
   open (read-only dashboards, health). Violation → 401 (no information).
2. Shell: `invoke('loopback_token')` relays the file (Err until the server
   boots once — client treats absence as the no-token path).
3. Client: `getLoopbackToken()` (module-memory cache, never persisted) →
   `x-baraka-loopback` on sale/settlement/raw-print POSTs. No token (browser
   preview, server down) → 401 → existing null path → provisional + outbox.
   Zero behavior change on the degraded lane.
4. Tests: fetch shim auto-attaches the token (18 write sites untouched);
   negative test asserts 401/401/200. `cargo check` gates the Rust command.

## Evidence (TDD RED → GREEN + live gate)
- RED: harness crashed on missing token file → GREEN after middleware.
- `server/index.test.ts` 20/20 (19 + T4 negative). Full suite **215/215**.
- Live: no-token POST → 401, wrong token → 401, GET → 200.
- `cargo check --offline` clean (2m57s); `cargo fmt` applied to main.rs.

## Consequences
Localhost writes are now authenticated. Rotation = delete the file.
T4b next: prod commit lane via Tauri invoke commands (exe ships no loopback).
