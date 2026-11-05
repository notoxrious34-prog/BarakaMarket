# ADR-039-MKT: Phase A stabilization decisions (tag, dead-lane, wire cases)

- **Status:** ACCEPTED
- **Date:** 2026-11-05
- **Phase:** A (v1.4.10 «التثبيت»)

## 1. Remote tag `v2.0.0-mkt` — ARCHIVED, not merged, not deleted

- **Fact:** `v2.0.0-mkt` → `2fbf590` → commit `f0fb757` ("release manifest for v2.0.0-mkt", 2026-10-27, ADR-016).
  Verified `git merge-base --is-ancestor f0fb757 HEAD` = true: the tag is a
  **historical milestone inside our own history**, not a parallel future.
- **Decision:** ARCHIVE. The tag stays; it marks the charter-era gold master
  (package.json said `2.0.0` then; the line continued as 1.4.x production).
  No v2 work may reference it until a dedicated v2 ADR re-opens the number.
- **Rule:** every future tag is created only by the §7 release procedure, and
  `git tag` (local) vs `git ls-remote --tags` (remote) must match at session end.

## 2. Print-lane correction — session report §12.3 was imprecise

- **Claim was:** "`spoolRawBytes` (print-lane) بلا منادين".
- **Verified truth:** `spoolRawBytes` IS called — by `printSaleAuto`,
  `showPoleTotal`, `showPoleTendered` (same module), which ARE called by
  `AppContext.tsx:1336-1337` and `PaymentModal.tsx:61`. The lane is live in
  browser-dev and degrades gracefully (null/false, never throws) on the
  installer, where Lane B (CSS `window.print` modal) is the real path.
- **Decision:** RETAIN as-is. By-design fire-and-forget with tests
  (`print-lane.test.ts`); no code change. Lesson recorded: verify callers by
  search, never from memory — even our own reports.

## 3. `isSessionLive` / `pin.reset` — RETAINED deliberately

- `isSessionLive` has no production caller **by owner decision**: AppContext
  enforces manual lock only ("removed, do not re-add" the 60s idle ticker).
  The function stays as a tested utility documenting intent — zero runtime effect.
- `'pin.reset'` is a type-union member (zero cost) reserving the audit
  vocabulary for the future reset flow. No code change.

## 4. Rust `non_snake_case` — fixed at the root, wire untouched

- **Root cause:** 23 warnings were not sloppiness but the **Tauri invoke wire
  contract**: `#[tauri::command]` params MUST spell exactly what TypeScript
  sends (`userId`, `saleId`, `requesterRole`, …). Renaming one side breaks the exe.
- **Fix (idiomatic, not expedient):** every affected command now declares
  `#[tauri::command(rename_all = "camelCase")]` and uses snake_case params —
  Rust idiomatic, wire byte-identical. 3 stray-paren warnings fixed directly.
- **Result:** `cargo build` 0 warnings (was 26), `cargo test` 31/31,
  `npm run test:all` 392/392, `tsc` clean. Wire parity table verified by grep
  (TS keys unchanged: `userId/oldPin/newPin/displayName/requesterRole/saleId/
  voidedBy/archiveRef/cashierName/openingFloatCt/sessionId/movementType/
  amountCt/countedCashCt`).
- **Rule:** new Tauri commands with multi-word args MUST use
  `rename_all = "camelCase"` from day one — warnings are noise that blinds.
