# ADR-018-MKT: Client Autonomy & Entity Lifecycle (BRK-020)

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** v1.0.1

## Context
The production `.exe` runs standalone: no `localhost:3100` loopback server exists
beside the Tauri WebView. Three product tools and the backup manager showed the
developer banner `Loopback hors ligne — lancez npm run dev:server`, and suppliers /
clients had no edit/delete lifecycle.

## Decision
1. **In-client engines, zero fetch.** `CsvImportModal` runs `preflightCsv()`
   (`src/core/csv-importer.ts`) and UPSERTs into `AppContext` (barcode match →
   `updateProduct`, else `addProduct`; centimes÷100, milli÷1000, C-code→rayon map).
   `ShelfLabelsDialog` runs `generateA4LabelsHtml()` for A4 preview and opens an
   80mm browser print window with inline `generateEan13Svg()` strips.
   `LossModal` decrements `AppContext` stock and appends to the `baraka_losses_v1`
   localStorage journal. All `fetch('http://127.0.0.1:3100…')` calls and every
   loopback banner were deleted from these components.
2. **Two-lane backup.** `LocalSnapshotPanel` (export/import JSON of all
   `baraka_*` keys) is always rendered. The fiscal SQLite lane
   (`VACUUM INTO`, sha256, quarantine restore) renders only when loopback
   answers — no error banners in standalone mode.
3. **Protected CRUD.** Suppliers: edit modal (name/phone/NIF/address/…);
   delete blocked when `balance_due > 0` with a bilingual guard message, else
   confirm + `deleteSupplier`. Clients: new `deleteClient` context action; edit
   modal (name/phone/address/plafond); delete blocked when
   `credit_balance > 0` naming the amount, else confirm + delete.
4. **Header polish.** The `ESSAI: 50 ventes` trial badge was permanently removed
   from `Navbar.tsx`; license state lives only in Licence/Settings views.

## Consequences
- Standalone `.exe` is fully operable with zero terminal commands.
- Fiscal lanes (cash sessions, Z chain, SQLite backup) remain server-side by
  design; when loopback is absent the UI says so in product language.
- Loss journal is local-first (`baraka_losses_v1`, capped at 500 entries);
  fiscal loss postings stay a server-lane concern (unchanged `POST /api/losses`).

## Invariants preserved
Monetary monism (centimes), pad-6 sequences, Art.136 timbre, zero-cloud —
none touched. No `licensing.ts`, `sqlite.ts`, `schema.sql`, `escpos.ts`,
`fiscal.centimes.ts`, `PosView`/`PaymentModal`/`Navbar` contracts altered
beyond the badge removal.
