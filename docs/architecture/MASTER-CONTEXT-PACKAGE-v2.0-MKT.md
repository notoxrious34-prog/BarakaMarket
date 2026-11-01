# Baraka Market — Master Context Transfer Package (v2.0-MKT core + v1.0.1 commercial)

> Unabridged handoff: architecture, fiscal law, engines, ledger. For the full
> per-task evidence see `docs/adr/ADR-001..ADR-018`, `TEST-REPORT.md`, and git log.

## 1. Identity
Baraka Market (سوق البركة) — Standard Supermarket Edition, fixed retail price
**5,000 DZD**. Windows 10/11 64-bit via Tauri v2 + NSIS. Local loopback
`127.0.0.1:3100`, zero cloud, zero subscription, 100% offline-capable.
Commercial release **v1.0.1** (`com.barakamarket.pos`, 1280×800).

## 2. Architectural Decisions Register
- **ADR-001** Runtime ratification: Tauri v2 + React 19 + TS + SQLite WAL.
- **ADR-002** Offline licensing: Ed25519, HWID `BM-XXXX-XXXX-XXXX-XXXX`,
  50-sale/14-day trial checkout lockout, verify-only client (`AK-…` keys).
- **ADR-003** Universal variable-weight scale barcodes (prefixes 20/21/22/28/29).
- **ADR-004** Multi-barcode aliases + multipack colisage conversion.
- **ADR-005** Algerian cash tender cockpit (500/1000/2000/5000 DZD presets,
  1% Timbre Fiscal, ESC/POS drawer kick, giant Emerald change HUD).
- **ADR-006** Perishable expiry tracking + Losses/Casse ledger.
- **ADR-007** POS cockpit zero-scroll layout stabilization.
- **ADR-008** Dual-theme contrast + UI polish.
- **ADR-009** Zero-dependency bulk CSV importer (dry-run preflight).
- **ADR-010** Shelf-edge labels (GS1 EAN-13 SVG, 80mm thermal, 3×8 A4).
- **ADR-011** Supplier BL receiving + automated PMP cost refresh.
- **ADR-012** Carnet de Dette + 80mm settlement quittance (`Q-YYYY-XXXXXX`).
- **ADR-013** Cash sessions lifecycle + monotonic 80mm Z-report (hash chain).
- **ADR-014** Manager PIN gate (salted SHA-256, `manager_pin_hash`) + `void_log`.
- **ADR-015** Hot backup (`VACUUM INTO`) + quarantine restore drill.
- **ADR-016** Tauri packaging hardening + Gold Master gate (`verify:release`).
- **ADR-017** Algerian reference catalog (28 cats / 257 templates / 112 brands,
  C001–C028 with 0/9/19% TVA) + Owner single-click keygen
  (`scripts/keygen-gui.ts`, `generate-license.cmd`).
- **ADR-018** Client autonomy (in-client CSV/labels/loss/snapshot, no loopback
  banners) + supplier/client CRUD with debt guards.

## 3. Non-negotiable invariants
1. **Monetary monism:** float money permanently banned; integer centimes + `qty_milli`.
2. **Legal audit trail:** fiscal IDs only from the atomic `seq` engine, pad-6
   (`FACT/T/Q/Z-YYYY-XXXXXX`); `sales.length`-style sequences forbidden.
3. **Art.136 reconciliation:** timbre on ALL ESPECES inflows ≥ 50 DZD incl. debt recovery.
4. **Zero-cloud:** no dead SDKs, no telemetry in `package.json`.
5. Zero-mouse full transaction; authoritative fiscal bridge in-shell; zero-blob
   audio (WebAudio synth); ESC/POS purity; Z tamper-evidence chain; air-gapped
   license determinism; single-click offline deployment; zero-regression.

## 4. Database — 22 tables
`meta, store_profile, products, product_barcodes, inventory_losses, clients,
suppliers, seq, sales, sale_items, client_settlements, active_cart_draft,
purchases, purchase_items, supplier_payments, z_reports, void_log,
cash_sessions, cash_movements, backups_log, ref_categories, ref_templates.`
Pragmas: WAL, `foreign_keys=1`. Backup: `baraka-backup-YYYYMMDD-HHMMSS[-label].sqlite`,
quarantine `data/quarantine/pre-restore-quarantine-*.sqlite`.

## 5. Engines & lanes
Browser-safe core: `fiscal.centimes`, `display`, `money`, `reference-search`,
`reference-catalog` (Node loader), `csv-importer`, `barcode-svg`,
`shelf-labels`, `escpos`, `sound`, `scanner`, `sha256`, `licensing`
(verify-only), `zreport`, `license-store`. Server lanes (Express, `server/`):
products, reference templates, CSV import, labels, losses, suppliers/BL,
clients/settlements, cash/Z, backups, PIN/void. UI local state: `AppContext`
(`baraka_*_v2` localStorage) with 14 seeded Algerian products.

## 6. Hardware matrix
80mm ESC/POS (`1B 40`, center, `ESC ! 32/48`, kick `1B 70 00 19 FA`,
cut `1D 56 42 00`), cash drawer, scale barcodes 20/21/22/28/29, A4 3×8 sheets.

## 7. Build & release ledger
`npm run lint` (tsc) · `npm test` (195/195) · `npm run build` (Vite) ·
`npm run verify:release` (Gold Master) · `npm run tauri build` (NSIS).
Tags: `v2.0.0-mkt` (charter seal) → `v1.0.1-mkt` (commercial).
Keygen: `scripts\generate-license.cmd "Name" "BM-XXXX-…"`. Installer:
`$CARGO_TARGET_DIR/release/bundle/nsis/Baraka Market_1.0.1_x64-setup.exe`
(shop machine: `CARGO_HOME`/`CARGO_TARGET_DIR` on D:, C: is full).
