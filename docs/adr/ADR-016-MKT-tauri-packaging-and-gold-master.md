# ADR-016-MKT: Tauri v2 Packaging & Gold Master Verification

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

With 186/186 green across Phases 0–5.1, the remaining risk is the release
itself: a misconfigured bundle (wrong id, dev secrets, broken window) or
an unverified tree cut as Gold Master. The manifest must be enterprise-grade
and the audit automated, not manual.

## Decision

1. **Manifest:** `productName Baraka Market`, version `2.0.0`, identifier
   `com.barakamarket.pos`; window 1280×800 (min 1024×700, resizable, not
   fullscreen, centered); NSIS `currentUser` single-click with embedded
   bootstrapper (no admin prompt for shop PCs); no `resources` key, so no
   `.pem`, quarantine, WAL/SHM or test files can ride the installer;
   CSP keeps the `127.0.0.1:3100` loopback lane while denying foreign
   origins.
2. **Gold Master script** (`scripts/verify-release.ts`, `npm run
   verify:release`): key hygiene (`.gitignore` bans `*.pem`, zero `.pem`
   under `src/`/`dist/`, 64-hex `BARAKA_PUBLIC_KEY` present); fresh
   `:memory:` bootstrap asserting `integrity_check = ok`, the exact
   20-table set, seeded store profile and a well-formed `T-YYYY-XXXXXX`
   seq; dist scan rejecting non-allowlisted remote URLs; then the real
   gates (`lint`, `build`, `test:all` ≥ 186, 0 fail). Exit 0 = READY.
3. **Consolidation:** overlapping DAL/server files made per-task commits
   unsafe, so the tree was sealed in three verified commits — `fc1feda`
   (engine), `2050a54` (evidence), plus the release commit.

## Consequences

* Positive: reproducible Gold Master signal; installer identity locked;
   secrets structurally excluded from the bundle.
* Accepted: the spec's "16 tables" is corrected to the real 20-table
   census (the spec's own list already names 20); `package.json` bumped
   to 2.0.0 alongside the manifest. The audit surfaced two true facts now
   encoded: `store_profile` content is shop-onboarded (schema carries the
   contract, not a default row; no users table exists) and the dist
   allowlist covers inert literals only (React `react.dev` error docs,
   the `w3.org` SVG namespace).
