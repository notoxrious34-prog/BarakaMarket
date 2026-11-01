# ADR-035-MKT — T12 fix: native `change_pin` (login unblocked)

- Status: ACCEPTED 2026-11-01 (code + tests green; ships in the rebuilt 1.1.0).
- Updates: extends ADR-031 (T8 RBAC).
- Related: PROGRAM-BLUEPRINT-v2.0 T12.

## Context

Shop-blocker, reported with screenshot: in the installed exe, first login as
`owner` (PIN 1234) correctly forces a PIN change — but new → confirm → OK
always fails with "تعذّر تغيير الرمز — تحقق من الاتصال".

Root cause: `changeSessionPin` (`session-authority.ts`) calls
`invoke('change_pin')`, but **no such command existed** in `main.rs` (T8
shipped `user_verify`/`user_list` only; the missing lane was even documented
in-code as "arrives with T8b"). `invokeNative` returned null, the Tauri
branch returned `false` without trying the loopback (correct — no server runs
in the shell), and the screen showed the connection error. The exe could
verify the owner but never let him past forced-change: a full lockout.

## Decision

Implement the missing lane natively (three surgical edits, no behavior change
elsewhere):

1. `auth.rs::user_change_pin` — old PIN must verify (generic rejection, audit
   `pin.change` on mismatch), new PIN format-checked (4–8 digits), verifier
   re-minted, `must_change_pin` cleared, success audited.
2. `main.rs::change_pin` command + handler registration (arg names mirror the
   existing `invokeNative('change_pin', { userId, oldPin, newPin })` contract).
3. `session-authority.ts` comment corrected (native owns PIN change).

No lockout counting on mismatch: identity was just proven via verify (or the
session is mid forced-change after a successful verify), and counting here
could wedge a legitimate forced-change into a lockout loop.

## Consequences

- Forced-change works in the exe; the owner can enter the till.
- Test: `change_pin_verifies_old_clears_forced_flag` (wrong-old rejected,
  bad-format rejected, change ok, `must_change_pin` 0, new PIN verifies).
- The already-built 1.1.0 setup in `releases/` PREDATES this fix and must be
  rebuilt before any Release (recorded in the T12 close-out).
