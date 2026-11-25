/**
 * Baraka Market — rapide cap key constants (browser-safe, zero imports).
 *
 * ADR-051 P2: caps live in meta KV (centimes); 0/absent = unlimited.
 * These two string keys used to live in `db/sqlite.ts`, whose module graph
 * pulls `node:sqlite` + `reference-catalog.ts` (`node:fs/url`) and kills
 * the vite browser boot. Client code (Store settings) imports from here;
 * `db/sqlite.ts` re-exports the same values so the native lane and tests
 * keep a single source of truth.
 *
 * @module core/rapide-limits
 */
export const RAPIDE_CAP_DAY_KEY = 'rapide_cap_day_ct';
export const RAPIDE_CAP_CASHIER_KEY = 'rapide_cap_cashier_ct';
