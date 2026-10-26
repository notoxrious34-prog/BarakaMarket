# CHANGELOG

## v1.0-rc1 (2026-10-26) — Session delivery
### Added
- `src/core/money.ts`, `fiscal.centimes.ts`: integer-centimes fiscal engine (TVA 0/9/19, timbre ESPECES-only, scale parser)
- `src/core/cart-bridge.ts`: drop-in UI bridge — AppContext money paths now compute in centimes
- `db/schema.sql` (15 tables, WAL, CHECK gates) + `src/db/sqlite.ts` (atomic sequencer, validated recordSale, void journal, VACUUM backup)
- `server/index.ts`: local API (health/products/sales/void/z-summary/backup) + live integration tests
- `scripts/`: seed-db, migrate-localstorage, bench-core, READMEs; `npm run test:all/api/seed/migrate/bench`
- Docs: PLAN_DIRECTEUR_v1.0, TEST-REPORT, DELIVERY, TAURI-PLAN
### Fixed
- Vite native-config `__dirname` warning → `import.meta.dirname`
- tsc errors in migrate script (typed legacy DTOs)
### Verified
- 33/33 tests green · tsc EXIT 0 · vite build success · bench PASS · migration dry-run 0-drift
