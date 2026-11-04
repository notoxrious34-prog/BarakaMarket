# DELIVERY — Baraka Market v1.0-rc1 (session delivery)

## What is delivered (verified this session)
- [x] Web POS app (`npm run dev` :3000 / `dist/` built) with money paths running on the
      integer-centimes engine via `src/core/cart-bridge.ts` (same UI, deterministic core)
- [x] Fiscal determinism: TVA 0/9/19 only, timbre 1% ESPECES-only [10,2500] exempt <50DZD
- [x] SQLite WAL database + seed (`npm run seed` → `data/baraka.db`, 143KB, 12/4/5/1)
- [x] Local authoritative API (`npm run api` :3100): health/products/sales/void/z-summary/backup
- [x] Migration tool (`npm run migrate`) + DevTools export one-liner in scripts/README.md
- [x] Backups via `VACUUM INTO` (API + tested `backupTo`)
- [x] Bench PASS (sub-ms engine) · 33/33 tests · tsc clean · build clean
- [x] Git history: baseline commit + delivery commit

## Runbook (shop PC, Windows 10/11)
1. Install Node 22+ LTS. 2. Copy this folder to `D:\BarakaMarket` (avoid C: if full).
3. `npm install --legacy-peer-deps` (if C: is full: `TMPDIR=D:\npm-tmp npm install --cache D:\npm-cache --legacy-peer-deps`).
4. `npm run seed` → verify `data/baraka.db`. 5. `npm run dev` (UI) and/or `npm run api` (API lane).
6. Daily: `POST /api/backup` before Z close; copy the dated `.db` to USB.

## Delivered after v1.0 — release log (verified per release)
- [x] v1.1.1 — outbox inspector, legacy boot, live version, timbre disclosure · signed · iron smoke + login E2E.
- [x] v1.2.0 — cashier comfort (linguistic, contrast, qty, guards, settings) · signed · iron smoke (POS live V1.2.0).
- [x] v1.3.0 — Phase 3 C1-C5 (keypad core, ledger, ceilings, expiry, shortcuts) · signed · iron smoke.
- [x] v1.3.1 — KeyPad unification (payment + login PIN share caps).
- [x] v1.3.2 — cash cockpit two-column, keypad RIGHT · lane COCKPIT 4/4 · signed · released.
- [x] v1.3.3 (2026-11-02) — cockpit raffiné: compact keypad-right tray, gold NET band, 50px keys ·
      293/293 · tsc/lint/build clean · `SIG-OK [ED]` · `v1.3.3` 3 assets `uploaded` ·
      web-lane vision PASS + **iron smoke PASS** (`D:\BarakaMarket-1.3.3`, footer `V1.3.3`,
      payment modal `672×708` on iron, vision PASS, zero defects).
- [x] BarakaKeygen v2 — owner activation desk (`releases/BarakaKeygen.exe`, 103MB):
      generate/verify/history/quit, queue line-reader, `CHECK: VALID` proven via piped stdin.
- [x] #003 SQLite invoke bridge (2026-11-02) — Rust `next_invoice/void_sale/daily_z/backup_db` (18/18) ·
      TS `commitVoid/backupDatabase/fetchDailyZ` · `sale.void` (manager+) + Z-view void surface ·
      one-shot golden migration + single-lane parity · **302/302** · tsc/lint/build clean.
- [x] #004 legal day-lock Z (2026-11-02) — `close_kind` DAY/SHIFT + v6 migrate · lock + hash chain
      (TS + Rust, 19/19) · ledger-verified close, voids/sales/shifts refused on locked day ·
      UI reprints from the stored row (`TICKET_EQUAL: true`, vision PASS 1366+768) ·
      live: `Z-2026-000003` 714.00 DZD, 2nd close refused `400` · **308/308** · tsc/lint/build clean.
- [x] **v1.3.4 auto-update pushed & installed (2026-11-03)** — NSIS `BarakaMarket-1.3.4-setup.exe`
      (5.13 MiB) signed (`SIG-OK [ED]`) + `latest.json` live on the release (`windows-x86_64`
      key fix — `windows-x64` is rejected by the Tauri v2 updater) · iron `1.3.3` saw `1.3.4`,
      installed it (`update.install` in the iron audit log, new binary, footer `V1.3.4`,
      vision PASS on the receipt cards) · carries: manual lock + clean start + receipt
      edit/delete · **314/314** · tsc/lint/build clean.
- [x] Owner 2026-11-03 — manual-only lock (idle ticker removed, lock is an overlay,
      cart 660 DZD survives lock/unlock, lane-proven) · «بداية نظيفة» owner-PIN clean
      start (demo wiped, users/identity/license kept, CLEAN_START blocks reseed) ·
      supplier receipt edit/delete (manager+, stock reversal + PMP, BR number kept,
      lane: 20→7→deleted + 6/6 unit) · vision PASS (danger zone, receipt cards) ·
      **314/314** · tsc/lint/build clean.
- [x] **Owner 3 points + v1.3.5 on iron (2026-11-03)** — TVA/timbre regime toggles
      (Card 3, per-sale flags, v7 migrate TS+Rust, ticket footnotes) · Stock CSV export
      + importer hardening (5000 cap, collision counts, `stock.import/export` audit) ·
      Backup-Pro (manifest sidecar, fail-closed validate, retention 30, USB download,
      token-gated UI) + local snapshot rebuilt (all `baraka_*` keys incl. seq + SHA-256
      envelope, 4 unit tests) · lane-found fixes (token attach, bidi `dir=ltr`) ·
      NSIS `BarakaMarket-1.3.5-setup.exe` (5.13 MiB, `SIG-OK [ED]`, 3 assets, CDN live) ·
      iron saw `Installer 1.3.5 + redémarrer`, installed (`update.install 1.3.5`, footer
      `V1.3.5`, totals verified, vision PASS) · **332/332** · tsc/lint/build clean.
- [x] **Owner tasks (2026-11-02)** — auto-update dry-run PASS on iron (`À jour — 1.3.3`, nothing installed) ·
      reception inline new-product (manual barcode/TVA 9%/epicerie, lane-proven) ·
      products DB read-only audit clean (14 exe / 14 loopback / 14 UI, zero defects, no fixes applied).
- [x] **v1.4.0 navbar + v1.4.1 hotfix (2026-11-04)** — Navbar redesign Phases 1-4 (DAILY 4 +
      More menu, live clock, unified hold, scale split, `aria-current`, 1100px stop, lanes 7/8/9
      vision PASS) · **v1.4.0 SHIPPED WITH A NATIVE-LANE OUTAGE** (disclosed): `LATEST=6`
      vs migrate stamping v7 bricked every native command on second launch (login fails,
      audit `…`, no update rows) · fixed in **v1.4.1** (`LATEST=7` + reopen-idempotency Rust
      test proven to fail on 6) · retention hardened (2.8 s unlink budget + honest row,
      test now asserts the log-anchored invariant after catching same-second filename
      recycling) · NSIS full-bundle = cumulative by construction (any jump lands everything;
      migrate `if v < N` climbs any old DB in one open) · **332/332** · cargo **21/21** ·
      tsc/lint clean.

## Explicitly deferred (with plan, not hidden)
- [ ] Tauri single-exe installer (<60MB) → docs/TAURI-PLAN.md (Rust present: cargo 1.98.1)
- [ ] Real scale/printer hardware (simulation only) → Phase 3 wiring points kept (`ScaleSimulationModal`, ESC/POS lane in API)
- [ ] Physical kill -9 pull-the-plug test → Phase 5 with installer (WAL crash-model covered by tests)
- [x] Self-certification instead of external accountant (owner decision 2026-10-26):
      golden receipts (33/33 tests) + Z hash chain + migration 0-drift + bench PASS.
      External sign-off dropped from gates by owner waiver.
