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

## Explicitly deferred (with plan, not hidden)
- [ ] Tauri single-exe installer (<60MB) → docs/TAURI-PLAN.md (Rust present: cargo 1.98.1)
- [ ] Real scale/printer hardware (simulation only) → Phase 3 wiring points kept (`ScaleSimulationModal`, ESC/POS lane in API)
- [ ] Physical kill -9 pull-the-plug test → Phase 5 with installer (WAL crash-model covered by tests)
- [x] Self-certification instead of external accountant (owner decision 2026-10-26):
      golden receipts (33/33 tests) + Z hash chain + migration 0-drift + bench PASS.
      External sign-off dropped from gates by owner waiver.
