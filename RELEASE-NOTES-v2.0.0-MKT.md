# Baraka Market — Release Notes `2.0.0-mkt` (Build Gold Master)

## 1. Executive Summary & Edition Identity

- **Product Name**: Baraka Market (سوق البركة)
- **Release Version**: `2.0.0-mkt` (Build Gold Master)
- **Commercial Edition**: Standard Supermarket Edition (Fixed Retail Price: 5,000 DZD)
- **Target OS**: Windows 10 / 11 (64-bit standalone desktop via Tauri v2 + NSIS)
- **Runtime Topology**: Local Loopback architecture (`127.0.0.1:3100`), Zero Cloud Dependency, Zero Subscription, 100% Offline Resilience.

Charter v2.0-MKT is fulfilled at 100% across Phases 0–5: fiscal core, POS
cockpit, inventory, supplier/debt ledgers, cash sessions, security, backup,
packaging and Gold Master preflight — 186/186 automated tests green.

## 2. Architectural Decisions Register (ADR Index)

| ADR | Title |
|-----|-------|
| ADR-001-MKT | Runtime Architecture Ratification (Tauri v2 + React 19 + TypeScript + SQLite WAL) |
| ADR-002-MKT | Cryptographic Offline Licensing (Asymmetric Ed25519, HWID binding, 50-sale/14-day trial checkout lockout) |
| ADR-003-MKT | Universal Variable-Weight Scale Barcode Engine (Prefixes 20, 21, 22, 28, 29) |
| ADR-004-MKT | Multi-Barcode Aliases & Multipack Colisage Inventory Conversion |
| ADR-005-MKT | Algerian Cash Tender POS Cockpit (Presets 500/1000/2000/5000 DZD, 1% Timbre Fiscal, ESC/POS Drawer Kick) |
| ADR-006-MKT | Perishable Expiry Tracking & Inventory Losses (Casse) Ledger |
| ADR-007-MKT | POS Cockpit Zero-Scroll Layout Stabilization |
| ADR-008-MKT | Pixel-Perfect Dual-Theme Contrast & UI Polish |
| ADR-009-MKT | Zero-Dependency Bulk CSV Catalog Importer with Preflight Dry-Run |
| ADR-010-MKT | Universal Shelf-Edge Label Engine (GS1 EAN-13 SVG, 80mm ESC/POS continuous strip, 3x8 A4 sheet) |
| ADR-011-MKT | Supplier Delivery Receipt (Bon de Livraison) & Automated Cost Price FIFO Refresh |
| ADR-012-MKT | Customer Credit Ledger (Carnet de Dette) & 80mm Settlement Quittance Printing |
| ADR-013-MKT | Cash Drawer Sessions Lifecycle & Monotonic 80mm Z-Report Generation |
| ADR-014-MKT | Manager PIN Security Gate & Immutable `void_log` Audit Trail |
| ADR-015-MKT | Online SQLite Hot Backup Engine (`VACUUM INTO`) & Safe Quarantine Disaster Recovery Drill |
| ADR-016-MKT | Desktop Packaging Hardening, NSIS Single-Click Installer & Gold Master Release Preflight |

Full records: `docs/adr/`.

## 3. Database Topology & Integrity Specifications

20 tables: `meta`, `store_profile`, `products`, `product_barcodes`,
`inventory_losses`, `clients`, `suppliers`, `seq`, `sales`, `sale_items`,
`client_settlements`, `active_cart_draft`, `purchases`, `purchase_items`,
`supplier_payments`, `z_reports`, `void_log`, `cash_sessions`,
`cash_movements`, `backups_log`.

- SQLite Pragmas: WAL mode, `foreign_keys = ON`, `synchronous = NORMAL`
  (single-statement `UPDATE..RETURNING` seq bumps keep fiscal numbering
  atomic under concurrency).
- Mathematical Integrity: strict integer centimes (`INTEGER` / `i64`) and
  milli-unit quantities (`qty_milli`) — binary floating point is banned
  from money paths (INVARIANT 1, MONETARY MONISM).
- Fiscal chain: Z-reports are finalized, immutable and SHA-256 hash-chained
  (`Hash_n = SHA256(prev ‖ number ‖ day ‖ totalTTC ‖ totalTimbre)`).

## 4. Hardware & Peripherals Compatibility Matrix

- **Barcode Scanners**: 1D/2D USB HID Keyboard Wedge scanners, high-speed
  omnidirectional multi-line laser scanners.
- **Retail Scales**: Variable weight and price printing scales
  (Mettler Toledo, Dibal, Bizerba, CAS, Rongta) emitting EAN-13 barcodes
  with prefixes 20, 21, 22, 28, 29.
- **Thermal Receipt Printers**: 80mm ESC/POS receipt printers
  (Epson, Xprinter, Rongta, Bixolon) via direct print spooling.
- **Cash Drawers**: Standard 12V/24V RJ11/RJ12 solenoid cash drawers
  triggered via thermal printer pin 2 (`ESC p 0 25 250`).
- **Customer Displays**: Strictly excluded by charter requirements.

## 5. Deployment & License Generation Guide for Store Owners

Generating an offline activation key:

```bash
npx tsx scripts/keygen.ts "<StoreName>" "<HWID>"
```

- Output activation key format: `AK-<base64url-signature>`.
- Offline license activation process via POS Store Settings view:
  1. Read the machine HWID shown in Store Settings → License.
  2. On the owner machine, run `keygen` with the exact store name + HWID.
  3. Paste the `AK-…` key into the License field and activate — no
     internet required at any step (trial: 50 sales / 14 days, then
     checkout lockout until activation).

Single-click NSIS installer (`currentUser`, embedded bootstrapper) provisions
the native shell and the embedded SQLite database on first run — no runtime
configuration on the air-gapped POS machine.
