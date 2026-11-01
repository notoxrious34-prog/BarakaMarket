# ADR-031-MKT — T8: full RBAC (users, PIN, lockout, audit)

- Status: ACCEPTED 2026-11-01 (T8 DONE — 258/258 + Rust 11/11 + live E2E).
- Updates: none (new record).
- Related: ADR-025 (loopback token), ADR-026 (native commit lane), PROGRAM-BLUEPRINT-v2.0 T8.

## Context

The shop ran on a hardcoded operator (`C-01/Amine`). The mandate requires
full users + roles (cashier/manager/owner + PIN + lock + audit). The DAL,
the loopback, the native shell, and the UI each enforce — never just the UI.

## Decision

1. **One hierarchy, one table.** `owner ⊇ manager ⊇ cashier`; a single
   `MIN_RANK` table over 11 permissions (`src/core/rbac.ts`). No scattered `if`s.
2. **PIN = credential.** `saltHex:hashHex` SHA-256 verifiers, identical format
   TS ↔ Rust (NIST vectors pinned in `auth.rs`). T8b upgrades the KDF to
   scrypt/argon2 when crates are vendored (verifier versions cleanly).
3. **Self-auth posts bypass the loopback token.** `/users/verify` + `/users/pin`
   carry the PIN (old PIN required for change); 5-strike lockout with
   `60s·2^cycles` backoff + audit is the brute-force shield. All other writes
   still require `x-baraka-loopback`. Mount-strip gotcha recorded:
   inside `app.use('/api')` the path is `/users/verify`, tested by a
   token-less negative test (`_rawFetch` — the file's fetch shim injects the token).
4. **CORS on the loopback.** The dev browser/√iew is a foreign origin; without
   CORS every lane fetch dies at preflight and the browser is stuck provisional
   forever (the FISCAL probe can never answer). Safe: writes keep the token,
   no endpoint returns it. After the fix the browser reports FISCAL live.
5. **Sessions, not secrets, in the browser.** `localStorage` keeps identity +
   timestamps only. Idle lock at 15 min (60s ticker), manual lock, logout —
   all audited. First owner login forces a PIN change before any session exists.
6. **Identity on every row.** `cashier_id = U-{id}` from the live session on
   fiscal + provisional rows; `completeSaleFiscal/settleClientDebt` throw
   without a session (the LoginScreen gate is the first wall, not the only one).

## Consequences

- Owner sees 8 tabs + users + audit; manager loses settings/users/license;
  cashier keeps pos + clients only. Server re-checks `requesterRole`.
- E2E proven live: `owner/1234 → forced change → 5678 → POS`,
  audit `seed → login.ok → pin.change → login.ok`, session survives reload.
- Test friction noted: synthetic `.value=` + untrusted `input` events do NOT
  move React-19 controlled state — future E2E must use trusted fill,
  `requestSubmit` on the right form, or seed `localStorage` + flag keys.
