# ADR-037-MKT — T8b: native user management (creation + activation in the exe)

- Status: ACCEPTED 2026-11-05 (code + tests green; ships with the next build).
- Updates: extends ADR-031 (T8 RBAC) and ADR-035 (T12 native `change_pin`).
- Related: `Paramètres & Fiscalité → Utilisateurs` institutional audit.

## Context

Institutional audit of the Utilisateurs page proved the write lane dead in
production: `createSessionUser` / `setSessionUserActive`
(`session-authority.ts`) returned `null`/`false` immediately under Tauri
("T8b: native user management"), and `main.rs` registered no such commands.
The exe could verify users, list them and change PINs — but the owner could
never create or (de)activate anyone: every attempt ended in a generic
"Création impossible". Same class as #PROD-LOCAL / #PROD-SALE / #PROD-CASH:
a lane that only ever worked where a loopback server happened to run.

Secondary findings from the same audit:

1. No new account ever carried `must_change_pin = 1` (TS DAL default 0,
   Rust lane absent) — a handed-out PIN survived indefinitely, unlike the
   owner seed.
2. Failures were typeless (`null`/`false`), so the UI could only show one
   generic message for taken names, bad input, owner-gate and offline.
3. The page never fetched on mount — a persisted session opening the tab saw
   an empty list — and the PIN field was plain text with no confirmation.

## Decision

Invoke-first, loopback fallback, typed refusal — five surgical edits:

1. `auth.rs::user_create` / `auth.rs::user_set_active` — owner-gated
   (`requester_role == "owner"`), same validation as the TS DAL
   (username `^[a-z0-9._-]{3,20}$` post-lowercase, role in
   cashier/manager/owner, PIN 4–8 digits, UNIQUE → `username taken`),
   display-name trim/fallback/cap-40, `must_change_pin = 1` on create,
   owner accounts immune to deactivation, every change audited.
2. `main.rs::user_create` / `main.rs::user_set_active` commands + handler
   registration (arg names mirror the bridge call contract).
3. `session-authority.ts` — native `user_create`/`user_set_active` first,
   loopback POST fallback in the browser lane; failures captured in
   `lastUserLaneError()` (fiscal-lane `lastLaneError` pattern), never thrown.
4. `sqlite.ts::createUser` — same `must_change_pin = 1` default and
   display-name trim/fallback/cap-40, so both lanes accept byte-identical
   input.
5. `UsersManagerView.tsx` rebuilt: fetch-on-mount with lane state
   (loading/ready/offline), labelled fields, password PIN + confirmation +
   show toggle, per-row pending, destructive-action confirms (second-owner
   creation, deactivation), self/owner freeze with the reason on hover,
   mapped AR/FR refusal messages, `role="status"` live feedback.

Out of scope on purpose: authenticating `requesterRole` beyond the loopback
token / exe trust boundary (same trust level as every other lane — recorded
as follow-up F1), and PIN re-auth before destructive user actions (confirm
dialogs ship now, re-auth is follow-up F2).

## Consequences

- Owner user management works in the exe for the first time (create,
  deactivate, reactivate), with the exact validation matrix as the server.
- Every provisioned account must change its PIN at first login, on both lanes.
- UI refusals name the cause (taken / validation / owner-gate / offline).
- Tests: Rust `create_and_toggle_mirror_ts_rules`, TS bridge
  typed-reason + offline tests, DAL forced-change/fallback test;
  `tsc` + `test:all` + `cargo test auth::` green.
