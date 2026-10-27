# ADR-002-MKT: Asymmetric Licensing & Tamper Resistance

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor
* **Supersedes:** HMAC design of Gate-03 (TASK-BRK-001 accepted baseline)

## Context

TASK-AUD-002-MKT proved the symmetric `BARAKA_SECRET` ships inside the client
bundle (`dist/assets/*.js`), so any customer can mint unlimited keys; the HWID
included screen resolution (monitor swaps void licenses); trial expiry was a
soft badge with zero enforcement; license state lived only in deletable
`localStorage`.

## Decision

1. **Ed25519, verify-only client.** `scripts/keygen.ts` signs
   `CANONICAL_STORE‖HWID` with Node `crypto.sign(null, …)` using a private key
   loaded from `BARAKA_PRIVATE_KEY` or `.baraka-privkey.pem` (gitignored, never
   committed). `src/core/licensing.ts` embeds only the raw 32-byte public key
   (`BARAKA_PUBLIC_KEY`) and verifies via Web Crypto `subtle` — identical path
   in browser, Tauri WebView, and Node tests. Activation format:
   `AK-` + base64url(64-byte signature). `BARAKA_SECRET` is fully purged.
2. **Stable HWID.** `computeHwid = SHA-256(arch‖hostname‖osVersion‖seed)`;
   screen dimensions removed from all collectors. Store names canonicalized
   (`trim().toUpperCase()`) on both sign and verify paths.
3. **Hard trial lockout.** `isTrialExpired = !activated && sales≤0 && days≤0`
   (BOTH budgets exhausted). POS entry points (`Space`, `F9`, checkout button)
   divert to a bilingual lockout modal with a direct jump to the activation
   sanctuary; `PaymentModal.handleValidate` re-checks as belt-and-suspenders.
   Non-POS views stay read-accessible. No silent bypass exists.
4. **SQLite mirror.** On activation, the record (+HWID) is POSTed to
   `/api/meta/license_state` (fire-and-forget, 2 s cap); on startup, an empty
   `localStorage` triggers a restore that is accepted only on HWID match.

## Consequences

* Positive: extractable client bundle can no longer mint keys; monitor swaps
  safe; expiry enforced; cache clears survivable via mirror.
* Negative / accepted residual: HWIDs change vs. the HMAC era (no production
  keys were issued, re-mint is free); clock-rollback guard deferred (trial can
  still be stretched by backdating — tracked for a future task); loopback meta
  lane remains unauthenticated localhost-only.
* Gates: `test:all` green, `BARAKA_MARKET_SECRET` grep = 0, keygen smoke
  `CHECK: VALID`, `vite build` clean.
