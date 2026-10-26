# ROADMAP — Baraka Market v1.0 → Shop-Ready (2026-10-26)

**Shipped (v1.0.0 installer):** full POS UI (AR/FR, dark/light), fiscal centimes engine
(33/33 tests), offline HWID licensing, Tauri NSIS installer (2MB), first-run SQLite
provisioning (15 tables, WAL), gold brand system (emblem + mark + tile icon).
**Lane status:** UI runs the verified localStorage lane; SQLite is provisioned but not
yet wired. Closing that gap is Phase A.

## Phase A — Fiscal hardening (order matters)
### #003 SQLite invoke bridge ← NEXT, unblocks everything below
- Rust `invoke` commands: `next_invoice` (UPDATE..RETURNING), `record_sale`,
  `void_sale` (no DELETE, void_log), `daily_z`, `backup_db` (VACUUM INTO).
- AppContext routes through `invoke` when `window.__TAURI__` exists, else
  localStorage fallback (browser QA stays valid).
- One-shot localStorage→SQLite migration with golden-dump equality (0-drift).
- Single-lane numbering: browser lane and exe lane must never both issue `T-…`
  (today they can collide — route through API/DB when reachable).
- **Gate:** sale in exe == sale in browser math; 1000 sequential invoices, no gap;
  kill-9 mid-sale → rollback proven.

### #004 Legal closing pack (P1 from QA-REPORT)
- `POST /api/z/close` + finalize button → record into `z_reports` (hash chain,
  day lock) + reprint-from-record equality test.
- FR plural fix (`1 article`), POS footer squeeze at 768px.
- **Gate:** printed Z == reprinted Z, hash verifies.

## Phase B — Hardware (blocked until devices on site)
- #005 ESC/POS direct print (USB/COM), 80mm ticket on REAL printer + A4.
- #011 RS-232 scale live test (simulator exists; real protocol run pending).
- Power-cut test: kill-9 mid-ticket → journal recovery demo.

## Phase C — Shop operations
- #006 Roles & PIN: cashier/manager, void + price-edit approval, lock screen.
- #007 Backups: auto-backup before Z, one-click restore, USB export, corrupt-DB
  self-heal from latest backup.
- #008 Signed auto-updates (Tauri updater) + release channel; SmartScreen note:
  unsigned NSIS warns — buy cert OR document the bypass for shop PCs.

## Phase D — Quality gates before store rollout
- Light-theme audit of ALL 8 views (license done; 7 remain) + 768px viewports.
- 8h soak: RAM <120MB, no leaks; keyboard-only full sale <150ms/step.
- Seed e2e: fresh install → seed → sell → Z → backup → restore → identical Z.

## Phase E — v2 horizons (explicitly NOT v1)
Multi-poste LAN sync, optional encrypted cloud backup, supplier price history
analytics, barcode label printing.

## Estimates (focused sessions)
#003: 2–3 · #004: 1 · #005/#011: 1 + hardware · #006: 1 · #007: 1 · #008: 1 · #010: 1.
**v1 shop-ready ≈ 8–10 sessions after today**, hardware-bound items excluded.
