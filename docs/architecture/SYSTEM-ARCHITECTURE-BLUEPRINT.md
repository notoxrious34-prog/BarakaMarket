# Baraka Market — System Architecture Blueprint (v1.0.1)

## 1. Runtime topology
Tauri v2 shell (`com.barakamarket.pos`, 1280×800) hosts the Vite React 19 bundle.
Optional Node/Express loopback (`127.0.0.1:3100`) provides the fiscal SQLite lane
(WAL, better-sqlite3). **Standalone rule (ADR-018):** every UI workflow must
complete with the loopback absent; server lanes render only when reachable.

## 2. Module map (Navbar → App route → view)
| Tab | Route | View | Lane |
|---|---|---|---|
| Caisse | `pos` | `POS/PosView` + `PaymentModal` | local cart; fiscal ticket via loopback when present |
| Produits & Stock | `products` | `Inventory/ProductsStockView` + `ProductToolModals` | local state; catalog local fallback |
| Achats & BL | `suppliers` | `Suppliers/SuppliersPurchasesView` | local + `recordPurchaseReception` (PMP) |
| Carnet de Dette | `clients` | `Clients/CarnetDetteView` | local ledger + quittance print |
| Compta | `accounting` | `Accounting/AccountingJournalView` | local aggregates |
| Rapport Z | `reports` | `Reports/DailyZReportView` | loopback when present |
| Clôture | `shifts` | `Cash/CashSessionsView` | loopback `/api/cash/*` |
| Licence | `license` | `License/LicenseManagerView` | Ed25519 verify-only, HWID `BM-…` |
| Système | `settings` | `Settings/StoreProfileView` + `BackupManagerView` | local snapshot + SQLite lane |

## 3. Data flow
```
UI events → AppContext (React state, localStorage baraka_*_v2)
  ├─ pure core engines (centimes, timbre, EAN-13, ESC/POS bytes, SVG labels, CSV)
  ├─ loopback REST (fiscal sequences, Z chain, SQLite VACUUM) — optional
  └─ Tauri shell (window, fs sandbox, NSIS bundle)
```

## 4. Database (22 tables, db/schema.sql)
`meta, store_profile, products, product_barcodes, inventory_losses, clients,
suppliers, seq, sales, sale_items, client_settlements, active_cart_draft,
purchases, purchase_items, supplier_payments, z_reports, void_log,
cash_sessions, cash_movements, backups_log, ref_categories, ref_templates.`
Sequences: `FACT/T/Q/Z-YYYY-XXXXXX` (atomic, monotonic, pad-6).
Z chain: `Hash_n = SHA256(Hash_{n-1} ∥ ReportNumber ∥ Date ∥ TotalTtc_ct ∥ TotalTimbre_ct)`.

## 5. Fiscal core (Algeria)
TVA 0/9/19 · Art.136 timbre: ceil 1% ∈ [10, 2500] on ESPECES ≥ 50 DZD incl.
debt settlements · integer centimes + `qty_milli` everywhere · variable-weight
scale barcodes (prefixes 20/21/22/28/29) · ESC/POS purity (no binary assets).

## 6. Offline engines (browser-safe, zero deps)
`reference-search` (Latin/Arabic scorer), `csv-importer` (preflight),
`barcode-svg` (EAN-13), `shelf-labels` (A4/80mm), `escpos`, `sound` (WebAudio),
`sha256`, `licensing` (verify-only), `zreport`, `license-store`.
