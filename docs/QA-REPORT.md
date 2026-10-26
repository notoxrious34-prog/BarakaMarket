# QA REPORT — Visual sweep + feature tests (2026-10-26)
Method: real Chromium via harness on `vite preview :4173` (production build) —
8 views screenshotted, barcode scan, full sale (scan→pay→ticket), FR toggle.
Console errors across sweep: **0**. Screenshots: `cache/scratch/qa/*.png` (session).
Unit layer: 33/33 green (unchanged).

## Verified working (with proof)
- All 8 views render fully (POS, Stock 12 items table, Suppliers 5 + BR-2026-0089,
  Clients 6 300 = 4 500+1 800+0 ✓, Accounting PMP 211 625/263 160/latent 51 535 ✓,
  net debt −74 700 ✓, Z ticket+KPIs, License hero emblem crisp, Settings NIF/RC/AI synced).
- Full cash sale: scan `6130000000021` → cart → `Valider & Imprimer` → ticket
  `T-2026-0001`, HT 1300 + Timbre 13 = 1313 ✓, NIF/RC/NIS/AI + address on ticket.
- FR toggle: 100% French, clean LTR, no breakage (only product master-data stays bilingual — intended).
- License emblem (new brand): crisp hero + navbar tile + v1.0-rc1 badge in legal bar.

## Defects (priority order)
### P1 — Z is a view, not a legal act
`DailyZReportView.tsx:20`: `useState(() => generateDailyZReport())` — computed once,
never persisted, no finalize/close button (only Print). A "daily closing" that isn't
recorded has no legal value. Fix: `POST /api/z/close` → insert into `z_reports`
(hash chain, lock day) + UI finalize button + reprint from record. (Schema + summary
endpoint already exist.)
### P2 — Scan yielded qty=2 from one programmatic scan (UNCONFIRMED)
One synthetic scan produced `2 × 650`. `handleBarcodeSubmit` (PosView:120) calls
`scanBarcode` once and is clean — likely a harness double-submit artifact. Repro needed
with physical Enter/scanner before judging. If real: audit submit paths for double-fire.
### P2 — POS grid bottom row squeezed under shortcut bar (short viewports)
Root `h-[calc(100vh-80px)]` + `overflow-hidden` (PosView:137): at ~800px viewport height
2nd-row prices clip. Fix: `shrink-0` footer + verify at 768px; or collapsible shortcuts.
### P3 — FR plural: `1 articles dans le panier` (PaymentModal.tsx:105)
Fix: `{n} {n > 1 ? 'articles…' : 'article…'}` (same pattern for AR already ok).
### P3 — FR nav label `Comptabilité SCF` truncates (`Comptab…`, ~1366px)
Fix: shorter FR labels (`Compta`) or icon-only collapse below `xl`.
### Dismissed (vision misreads, code-checked)
- Ticket `RC: …5011011` → code renders `{rc} | NIF`; seed is `16/00-501101`. Not a bug.
- Z table `DZD 0+` → no such template in code; misread of `+0.00 DZD`. Not a bug.

## Improvements for «أنيق وفخم وقوي»
Visual: light-theme pass (never screenshotted — audit all 8 views in light mode);
`@media print` audit for A4 invoice; empty-state polish for purchase history;
cashier lock/PIN screen (shop-floor reality).
Technical: React Error Boundary (today a crash = blank page); pre-commit `test:all`;
invoice numbering single-lane — browser lane and API lane can BOTH issue `T-2026-0001`
(proven this session); route numbering through API when reachable.
Architectural: converge lanes via Tauri `invoke` (plan in docs/TAURI-PLAN.md);
manager-PIN for voids + price edits; enforced backup-before-Z; Z hash chain (Phase 4 gate).

## Proposed next directive
**#004 LEGAL CLOSING PACK (P1 first):** `POST /api/z/close` + finalize button +
Z reprint from record + FR plural + footer squeeze fix. Est: 1 session, ends with
printed+reprinted Z equality test.
