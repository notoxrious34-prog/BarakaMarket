/**
 * Baraka Market — SQLite WAL data layer (Node-only, `node:sqlite`).
 * NEVER import this from browser components — server/scripts/Tauri-bridge only.
 * - All money: INTEGER centimes. All quantities: INTEGER milli-units.
 * - Sales are recorded under BEGIN IMMEDIATE (atomic seq bump + inserts + stock).
 * - Invoice/ticket numbers come from a single UPDATE..RETURNING statement (atomic).
 * - Voids NEVER delete: status -> CANCELLED + void_log row.
 * - The same db/schema.sql will feed @tauri-apps/plugin-sql in production.
 *
 * @module db/sqlite
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIntegerCentimes } from '../core/money.js';
import { calculateTimbreFiscalCt, type SaleTotalsCt } from '../core/fiscal.centimes.js';
import { GENESIS_PREV_HASH as GENESIS_Z_HASH, computeZHash as computeZHashDb } from '../core/zreport.js';
import type {
  PaymentMethod, TVARate, LossReason, InventoryLoss, ImportProductRow, BatchImportResult,
  SupplierDeliveryReceipt, DeliveryReceiptResult, SupplierStatement,
  ClientSettlementPayload, ClientSettlementResult, CreditEligibility,
  CashMovementType, CashSessionRecord, CashSessionLiveStatus, ZClosureResult,
  ProtectedActionType, VoidLogEntry, VoidLogRecord, VoidSummary,
  BackupMetadata, BackupValidationReport, RestoreResult,
} from '../types';
import { createPinHash, verifyPin, MANAGER_PIN_META_KEY, isValidPinFormat as isValidP } from '../core/security.js';
import { APP_VERSION } from '../core/version.js';
import {
  backupFilename, manifestPathFor, buildManifest, checkManifestShape, prunePlan,
  type BackupManifest,
} from '../core/backup-catalog.js';
import { isRole, registerAttempt, type Role, type AuditAction, type AuditEvent } from '../core/rbac.js';
import { loadReferenceCatalog, searchCatalog, type ProductTemplate } from '../core/reference-catalog.js';

export type Unit = 'PIECE' | 'KG' | 'LITRE';

export interface ProductRow {
  id: number;
  barcode: string;
  name_fr: string;
  name_ar: string;
  category_id: string;
  buy_price_ct: number;
  sell_price_ct: number;
  tva_rate: TVARate;
  stock_milli: number;
  min_stock_milli: number;
  unit: Unit;
  is_scale: number;
  scale_item_code: string | null;
  has_expiry: number;
  expiry_date: string | null;
}

export interface SaleHeaderInput {
  id?: string;
  cashier_id: string;
  cashier_name: string;
  client_id?: number | null;
  client_name?: string | null;
  client_nif?: string | null;
  client_nis?: string | null;
  client_rc?: string | null;
  client_ai?: string | null;
  client_address?: string | null;
  payment_method: PaymentMethod;
  amount_paid_ct: number;
  amount_returned_ct: number;
  totals: SaleTotalsCt;
  is_facture?: number;
  created_at?: string;
  /** Fiscal regime under which the client computed the totals (owner toggles).
   * The authority re-verifies with THESE flags and stores them per sale.
   * Absent = both taxes apply (legacy callers). */
  fiscal_regime?: { tva_enabled: boolean; timbre_enabled: boolean };
  /** T1 (ADR-021): checkout-minted idempotency key. Retried commits with the
   *  same key return the original row — seq is never consumed twice. */
  client_sale_id?: string | null;
}

export interface SaleItemInput {
  product_id: number | null;
  barcode: string;
  name_fr: string;
  name_ar: string;
  unit_price_ct: number;
  qty_milli: number;
  unit: Unit;
  tva_rate: TVARate;
  discount_bp: number;
  line_ht_ct: number;
  line_tva_ct: number;
  line_ttc_ct: number;
}

function assertTvaRate(v: number): asserts v is TVARate {
  if (v !== 0 && v !== 9 && v !== 19) {
    throw new Error(`[db] TVA rate must be 0, 9 or 19 (got ${v})`);
  }
}

export interface ProductBarcodeRecord {
  id: number;
  product_id: number;
  barcode: string;
  multiplier: number;
  pack_name: string | null;
  price_override_ct: number | null;
  created_at: string;
}

export interface ProductBarcodeResolution {
  product: ProductRow;
  isPack: boolean;
  multiplier: number;
  packName?: string;
  effectivePriceCt: number;
  barcode: string;
}

const LOSS_REASONS: readonly LossReason[] = ['EXPIRED', 'BROKEN', 'DAMAGED', 'THEFT', 'INTERNAL_USE', 'AUTRE'];

function assertLossReason(v: string): asserts v is LossReason {
  if (!(LOSS_REASONS as readonly string[]).includes(v)) {
    throw new Error(`[db] invalid loss reason: ${v} (expected ${LOSS_REASONS.join('|')})`);
  }
}

export interface RecordLossInput {
  product_id: number;
  qty_milli: number;
  reason: LossReason;
  unit_cost_ct?: number;
  total_loss_ct?: number;
  notes?: string | null;
  created_at?: string;
}

export interface LossQuery {
  reason?: LossReason;
  product_id?: number;
  from?: string;
  to?: string;
  limit?: number;
}

/** ADR-004-MKT: price_override_ct wins; else unit sell price x multiplier. */
export function effectivePackPriceCt(sellPriceCt: number, multiplier: number, priceOverrideCt?: number | null): number {
  assertIntegerCentimes(sellPriceCt, 'sellPriceCt');
  if (!Number.isInteger(multiplier) || multiplier < 1) throw new Error(`[db] multiplier must be >= 1 (got ${multiplier})`);
  if (priceOverrideCt !== undefined && priceOverrideCt !== null) {
    assertIntegerCentimes(priceOverrideCt, 'priceOverrideCt');
    return priceOverrideCt;
  }
  return sellPriceCt * multiplier;
}

function schemaSql(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
}

/**
 * A2 (PLAN-v1.2.0): column-first indexes must apply AFTER migration, never
 * at open. A legacy file predates columns the indexes reference (day,
 * created_at, …) and CREATE INDEX validates immediately — the open dies
 * before the climb. Tables/triggers/views ride the first pass (fail hard:
 * genuine corruption); every CREATE INDEX rides the post-migration pass.
 */
const INDEX_STMT = /CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?;/gi;

export function splitSchemaIndexes(sql: string): { core: string; indexes: string[] } {
  const indexes = sql.match(INDEX_STMT) ?? [];
  return { core: sql.replace(INDEX_STMT, ''), indexes };
}

/**
 * T3 foundation (ADR-021): versioned migrations. Fresh DBs are born at
 * LATEST_SCHEMA_VERSION via schema.sql; older files climb step by step.
 * Each step is idempotent (column/index existence checks) so a half-opened
 * DB can safely re-enter. NEVER delete/rename user rows in a migration.
 */
export const LATEST_SCHEMA_VERSION = 8;

/** Backup-Pro: retention — newest N snapshots kept, older pruned on create. */
export const BACKUP_RETENTION_KEEP = 30;

/**
 * Windows locks fresh files briefly (AV/indexer) — a single unlinkSync can
 * throw EPERM/EBUSY on a file that is really ours to delete. Retry with a
 * generous budget; swallowing the first EPERM silently breaks the retention
 * guarantee (proven by a load-induced flake that survived a 250 ms budget).
 */
function unlinkWithRetry(p: string, tries = 8): void {
  for (let i = 0; i < tries; i++) {
    try {
      fs.unlinkSync(p);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOENT') return; // truly gone or foreign error
      if (i === tries - 1) return;
      // Up to ~2.8 s total on a contended box — then the caller keeps the
      // log row so the NEXT backup retries instead of orphaning the file.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (i + 1));
    }
  }
}

function schemaVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

export function logAuditRow(db: DatabaseSync, e: AuditEvent): void {
  db.prepare(
    'INSERT INTO audit_log (ts, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(e.at ?? new Date().toISOString(), e.actor, e.action, e.entity ?? '', e.entityId ?? '', e.detail ?? '');
}

export interface SafeUser {
  id: number; username: string; display_name: string; role: Role;
  must_change_pin: number; active: number;
}

export interface AuditRow {
  id: number; ts: string; actor: string; action: string;
  entity: string; entity_id: string; detail: string;
}

interface UserRow extends SafeUser {
  pin_verifier: string; failed_attempts: number; locked_until_ms: number; lock_cycles: number;
}

/** Fetch a full user row or throw (internal — never leaves the DAL). */
function userRow(db: DatabaseSync, id: number): UserRow {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
  if (!row) throw new Error(`[db] user not found: ${id}`);
  return row;
}

/** Strip secrets before a user crosses the DAL boundary. */
const safeUser = (r: UserRow): SafeUser => ({
  id: r.id, username: r.username, display_name: r.display_name,
  role: r.role, must_change_pin: r.must_change_pin, active: r.active,
});

/** T11 (ADR-034): append-only + terminal-state guards. Mirrors schema.sql tail;
 * kept here (not schema.sql) for the v4→v5 climb so legacy files — whose open
 * predates the triggers — converge without failing at open. */
const APPEND_ONLY_TRIGGERS: string[] = [
  `CREATE TRIGGER IF NOT EXISTS trg_sales_no_delete
   BEFORE DELETE ON sales BEGIN
     SELECT RAISE(ABORT, 'append-only: sales rows are never deleted (void instead)');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_sale_items_no_delete
   BEFORE DELETE ON sale_items BEGIN
     SELECT RAISE(ABORT, 'append-only: sale_items rows are never deleted');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_settlements_no_delete
   BEFORE DELETE ON client_settlements BEGIN
     SELECT RAISE(ABORT, 'append-only: settlements are never deleted');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_sales_terminal
   BEFORE UPDATE OF status ON sales
   WHEN OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED' BEGIN
     SELECT RAISE(ABORT, 'terminal: a CANCELLED sale can never be resurrected');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_users_no_delete
   BEFORE DELETE ON users BEGIN
     SELECT RAISE(ABORT, 'append-only: users deactivate, never delete');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
   BEFORE DELETE ON audit_log BEGIN
     SELECT RAISE(ABORT, 'append-only: audit_log is immutable');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
   BEFORE UPDATE ON audit_log BEGIN
     SELECT RAISE(ABORT, 'append-only: audit_log rows are never modified');
   END`,
];

/** First-boot owner (PIN 1234, forced change). Idempotent, never rewrites. */
function seedOwnerIfEmpty(db: DatabaseSync): void {
  try {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    if (n > 0) return;
    db.prepare(
      `INSERT INTO users (username, display_name, role, pin_verifier, must_change_pin, created_at)
       VALUES ('owner', 'Gérant', 'owner', ?, 1, ?)`,
    ).run(createPinHash('1234'), new Date().toISOString());
    logAuditRow(db, { actor: 'system', action: 'user.create', entity: 'users', entityId: 'owner', detail: 'first-owner seed' });
  } catch { /* users table missing on exotic files — a later open retries */ }
}

export function migrateSchemaVersion(db: DatabaseSync): void {
  let v = schemaVersion(db);
  if (v > LATEST_SCHEMA_VERSION) {
    throw new Error(`[db] database is newer than this build (v${v} > v${LATEST_SCHEMA_VERSION}) — update the app`);
  }
  // v0/v1 → v2: T1 idempotency key on sales.
  if (v < 2) {
    const cols = db.prepare('PRAGMA table_info(sales)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'client_sale_id')) {
      db.exec('DROP INDEX IF EXISTS idx_sales_client_sale_id');
      db.exec('ALTER TABLE sales ADD COLUMN client_sale_id TEXT');
    }
    db.exec('PRAGMA user_version = 2');
    v = 2;
  }
  // v2 → v3: T2b idempotency key on client_settlements.
  if (v < 3) {
    const cols = db.prepare('PRAGMA table_info(client_settlements)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'client_settlement_key')) {
      db.exec('DROP INDEX IF EXISTS idx_settlements_client_key');
      db.exec('ALTER TABLE client_settlements ADD COLUMN client_settlement_key TEXT');
    }
    db.exec('PRAGMA user_version = 3');
    v = 3;
  }
  // v3 → v4: T8 users + audit_log (DDL rides schema.sql at open; the step
  // stamps legacy files and seeds the first owner when the table is empty).
  if (v < 4) {
    seedOwnerIfEmpty(db);
    db.exec('PRAGMA user_version = 4');
    v = 4;
  }
  // v4 → v5: T11 append-only + terminal-state triggers (ADR-034). Fresh files
  // get them from schema.sql at open; legacy files climb here, idempotent.
  if (v < 5) {
    for (const t of APPEND_ONLY_TRIGGERS) db.exec(t);
    db.exec('PRAGMA user_version = 5');
    v = 5;
  }
  // v5 → v6 (#004): close_kind marks DAY (legal lock, one per day) vs SHIFT
  // (cash-session snapshot, several per day allowed). Fresh files get it from
  // schema.sql; legacy files climb here.
  if (v < 6) {
    const cols = db.prepare('PRAGMA table_info(z_reports)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'close_kind')) {
      db.exec("ALTER TABLE z_reports ADD COLUMN close_kind TEXT NOT NULL DEFAULT 'DAY'");
    }
    db.exec('PRAGMA user_version = 6');
    v = 6;
  }
  // v6 → v7 (régime fiscal): per-sale tva_enabled/timbre_enabled flags.
  // Fresh files get them from schema.sql; legacy files climb here.
  if (v < 7) {
    const cols = db.prepare('PRAGMA table_info(sales)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'tva_enabled')) {
      db.exec('ALTER TABLE sales ADD COLUMN tva_enabled INTEGER NOT NULL DEFAULT 1');
    }
    if (!cols.some(c => c.name === 'timbre_enabled')) {
      db.exec('ALTER TABLE sales ADD COLUMN timbre_enabled INTEGER NOT NULL DEFAULT 1');
    }
    db.exec('PRAGMA user_version = 7');
    v = 7;
  }
  // v7 → v8 P3 (v1.4.4): retention-exempt flag for pre-reset safety archives.
  // Fresh files get it from schema.sql; legacy files climb here.
  if (v < 8) {
    const cols = db.prepare('PRAGMA table_info(backups_log)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'exempt')) {
      db.exec('ALTER TABLE backups_log ADD COLUMN exempt INTEGER NOT NULL DEFAULT 0');
    }
    db.exec('PRAGMA user_version = 8');
    v = 8;
  }
  // Always-ensured: partial unique index lives here (not schema.sql) so
  // old files that predate the column never hit "no such column" at open.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_sale_id ON sales(client_sale_id) WHERE client_sale_id IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_client_key ON client_settlements(client_settlement_key) WHERE client_settlement_key IS NOT NULL');
}

export interface BarakaDb {
  db: DatabaseSync;
  close(): void;
  pragmas(): { journal_mode: string; foreign_keys: number };
  upsertProduct(p: ProductRow): void;
  getProduct(id: number): ProductRow;
  /** ADR-004-MKT: alternate barcodes + multipack/colisage labels. */
  addProductBarcode(input: { product_id: number; barcode: string; multiplier?: number; pack_name?: string | null; price_override_ct?: number | null }): number;
  getProductBarcodes(productId: number): ProductBarcodeRecord[];
  deleteProductBarcode(id: number): void;
  resolveBarcode(barcode: string): ProductBarcodeResolution | null;
  /** ADR-006-MKT: auditable shrinkage ledger + expiry surveillance. */
  recordInventoryLoss(input: RecordLossInput): { id: number; stock_milli: number };
  getInventoryLosses(q?: LossQuery): InventoryLoss[];
  getExpiringProducts(daysThreshold: number): ProductRow[];
  /** ADR-009-MKT: atomic bulk catalog import (INSERT_ONLY skips, UPSERT merges). */
  importProductsBatch(rows: ImportProductRow[], mode: 'INSERT_ONLY' | 'UPSERT'): BatchImportResult;
  /** ADR-011-MKT: supplier BL receiving — atomic stock influx + cost + debt. */
  receiveSupplierDelivery(payload: SupplierDeliveryReceipt): DeliveryReceiptResult;
  getSupplierPurchases(supplierId: number, limit?: number): Record<string, unknown>[];
  getSupplierBalanceStatement(supplierId: number): SupplierStatement;
  /** ADR-012-MKT: atomic Carnet de Dette settlement + credit ceiling gate. */
  settleClientCredit(payload: ClientSettlementPayload): ClientSettlementResult;
  checkCreditEligibility(clientId: number, saleTotalTtcCt: number): CreditEligibility;
  getClientStatement(clientId: number): {
    client: Record<string, unknown>;
    settlements: Record<string, unknown>[];
    creditSales: Record<string, unknown>[];
  };
  /** ADR-013-MKT: cash session lifecycle + Z closure. */
  openCashSession(cashierName: string, openingFloatCt: number): CashSessionRecord;
  recordCashMovement(sessionId: string, type: CashMovementType, amountCt: number, reason: string): Record<string, unknown>;
  getCashSessionStatus(sessionId: string): CashSessionLiveStatus;
  getActiveCashSession(): CashSessionLiveStatus | null;
  closeCashSessionAndGenerateZ(sessionId: string, countedCashCt: number, notes?: string): ZClosureResult;
  /** Clôture rebuild (v1.4.5): the page needs history, not just the live row. */
  listCashSessions(limit?: number): CashSessionRecord[];
  /** ADR-014-MKT: manager override PIN + append-only void audit. */
  recordVoidLog(entry: VoidLogEntry): VoidLogRecord;
  getVoidLogs(filters?: { fromDate?: string; toDate?: string; reason?: string; limit?: number }): VoidLogRecord[];
  getVoidSummaryBySession(sessionId?: string): VoidSummary;
  setManagerPin(newPin: string): void;
  verifyManagerPinDb(inputPin: string): boolean;
  /** ADR-015-MKT: online backup + disaster recovery. */
  createDatabaseBackup(options?: { destinationDir?: string; label?: string; exempt?: boolean }): BackupMetadata;
  listDatabaseBackups(): BackupMetadata[];
  validateBackupForRestore(backupPath: string): BackupValidationReport;
  restoreBackupSafely(backupPath: string): RestoreResult;
  /** P3 (v1.4.4): audited clean-start — refuses without a VERIFIED exempt archive. */
  factoryReset(archiveRef: string, actor: string): { cleared: Record<string, number>; archive: string };
  /** TASK-BRK-016-MKT: Algerian reference catalog autofill search. */
  searchProductTemplates(query: string, limit?: number): ProductTemplate[];
  nextInvoiceNumber(year: number): string;
  nextTicketNumber(year: number): string;
  recordSale(header: SaleHeaderInput, items: SaleItemInput[]): { id: string; invoice_number: string; ticket_number: string };
  getSale(id: string): Record<string, unknown>;
  getSaleOrNull(id: string): Record<string, unknown> | null;
  activeSalesCount(): number;
  voidSale(saleId: string, reason: string, voidedBy: string): void;
  backupTo(destPath: string): void;
  /** TASK 4 — ACID ephemeral cart draft (power-cut resilience). */
  saveCartDraft(sessionId: string, payloadJson: string, itemCount: number, totalTtcCt: number): void;
  loadCartDraft(sessionId: string): { payload_json: string; item_count: number; total_ttc_ct: number; updated_at: string } | null;
  clearCartDraft(sessionId: string): void;
  /** TASK 3 — fiscal debt settlement with Art.136 timbre + quittance number. */
  recordSettlement(input: {
    id?: string; client_id: number; client_name?: string; amount_ct: number;
    payment_method: 'ESPECES' | 'CIB' | 'DAHABIYA' | 'CREDIT';
    timbre_ct?: number; total_collected_ct?: number; receipt_number?: string;
    date?: string; note?: string | null;
    /** T2b (ADR-024): checkout-minted idempotency key, stable across retries. */
    client_settlement_key?: string | null;
  }): { id: string; receipt_number: string };
  /** Gate-03 TASK 1 — tamper-evident Z-report closure. */
  finalizeZReport(input: {
    day: string; openingTime: string; closingTime: string;
    totals: {
      salesCount: number; totalHtCt: number; tva0BaseCt: number; tva9BaseCt: number;
      tva9AmtCt: number; tva19BaseCt: number; tva19AmtCt: number; totalTvaCt: number;
      totalTimbreCt: number; totalTtcCt: number; especesGrossCt: number; cibTotalCt: number;
      dahabiyaTotalCt: number; creditGrantedCt: number; creditCollectedCt: number;
      firstInvoice: string; lastInvoice: string;
    };
  }): { report_number: string; hash: string; prev_hash: string };
  getLatestZHash(): string;
  listZReports(): Record<string, unknown>[];
  /** Gate-03 TASK 3 — license + machine seed in meta KV. */
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  /** T8 (ADR-031) — users + security audit. */
  createUser(input: { username: string; display_name?: string; role: Role; pin: string }, actor: string): SafeUser;
  verifyUser(username: string, pin: string): { ok: true; user: SafeUser } | { ok: false; locked: boolean };
  listUsers(): SafeUser[];
  setUserActive(id: number, active: boolean, actor: string): void;
  changePin(userId: number, oldPin: string, newPin: string): void;
  listAudit(limit?: number): AuditRow[];
  logAudit(e: AuditEvent): void;
}

function bumpSeq(db: DatabaseSync, kind: 'FACT' | 'T' | 'Q' | 'Z', year: number): number {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`[db] invalid seq year: ${year}`);
  }
  db.prepare('INSERT INTO seq (kind, year, last_n) VALUES (?, ?, 0) ON CONFLICT (kind, year) DO NOTHING').run(kind, year);
  const row = db.prepare('UPDATE seq SET last_n = last_n + 1 WHERE kind = ? AND year = ? RETURNING last_n').get(kind, year) as { last_n: number };
  return row.last_n;
}

const pad6 = (n: number) => n.toString().padStart(6, '0');

/**
 * #004 (Phase A): true when a legal DAY close already freezes `day`.
 * SHIFT snapshots never lock — several shifts may close the same day.
 */
export function isDayLocked(db: DatabaseSync, day: string): boolean {
  const r = db.prepare(
    "SELECT 1 AS one FROM z_reports WHERE day = ? AND close_kind = 'DAY' LIMIT 1",
  ).get(day) as { one: number } | undefined;
  return !!r;
}

/** #004: ledger-truth aggregates for one business day (COMPLETED sales + ESPECES settlements). */
export interface DayAggregatesCt {
  salesCount: number; totalHtCt: number; tva0BaseCt: number; tva9BaseCt: number;
  tva9AmtCt: number; tva19BaseCt: number; tva19AmtCt: number; totalTvaCt: number;
  totalTimbreCt: number; totalTtcCt: number; especesGrossCt: number; cibTotalCt: number;
  dahabiyaTotalCt: number; creditGrantedCt: number; creditCollectedCt: number;
  firstInvoice: string; lastInvoice: string;
}

export function computeDayAggregates(db: DatabaseSync, day: string): DayAggregatesCt {
  const agg = db.prepare(
    `SELECT COUNT(*) AS n,
       COALESCE(SUM(total_ht_ct), 0) AS ht,
       COALESCE(SUM(tva0_base_ct), 0) AS b0,
       COALESCE(SUM(tva9_base_ct), 0) AS b9, COALESCE(SUM(tva9_amt_ct), 0) AS a9,
       COALESCE(SUM(tva19_base_ct), 0) AS b19, COALESCE(SUM(tva19_amt_ct), 0) AS a19,
       COALESCE(SUM(total_tva_ct), 0) AS tva,
       COALESCE(SUM(timbre_ct), 0) AS timbre,
       COALESCE(SUM(total_ttc_ct), 0) AS ttc,
       COALESCE(SUM(CASE WHEN payment_method = 'ESPECES' THEN total_ttc_ct ELSE 0 END), 0) AS cash,
       COALESCE(SUM(CASE WHEN payment_method = 'CIB' THEN total_ttc_ct ELSE 0 END), 0) AS cib,
       COALESCE(SUM(CASE WHEN payment_method = 'DAHABIYA' THEN total_ttc_ct ELSE 0 END), 0) AS dah,
       COALESCE(SUM(CASE WHEN payment_method = 'CREDIT' THEN total_ttc_ct ELSE 0 END), 0) AS cred,
       MIN(invoice_number) AS first, MAX(invoice_number) AS last
     FROM sales WHERE status = 'COMPLETED' AND substr(created_at, 1, 10) = ?`,
  ).get(day) as {
    n: number; ht: number; b0: number; b9: number; a9: number; b19: number; a19: number;
    tva: number; timbre: number; ttc: number; cash: number; cib: number; dah: number; cred: number;
    first: string | null; last: string | null;
  };
  const settled = db.prepare(
    `SELECT COALESCE(SUM(total_collected_ct), 0) AS t FROM client_settlements
     WHERE payment_method = 'ESPECES' AND substr(date, 1, 10) = ?`,
  ).get(day) as { t: number };
  return {
    salesCount: agg.n, totalHtCt: agg.ht, tva0BaseCt: agg.b0, tva9BaseCt: agg.b9,
    tva9AmtCt: agg.a9, tva19BaseCt: agg.b19, tva19AmtCt: agg.a19, totalTvaCt: agg.tva,
    totalTimbreCt: agg.timbre, totalTtcCt: agg.ttc, especesGrossCt: agg.cash,
    cibTotalCt: agg.cib, dahabiyaTotalCt: agg.dah, creditGrantedCt: agg.cred,
    creditCollectedCt: settled.t, firstInvoice: agg.first ?? '', lastInvoice: agg.last ?? '',
  };
}

export function openBarakaDb(dbPath: string): BarakaDb {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  // A2: core first (tables/triggers/views, fail hard); indexes after migrate.
  const { core: schemaCore, indexes: schemaIndexes } = splitSchemaIndexes(schemaSql());
  db.exec(schemaCore);
  // Idempotent migration for pre-existing baraka.db files (IF NOT EXISTS
  // does not add columns to old tables). Duplicate-column errors ignored.
  for (const ddl of [
    'ALTER TABLE client_settlements ADD COLUMN timbre_ct INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE client_settlements ADD COLUMN total_collected_ct INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE client_settlements ADD COLUMN receipt_number TEXT',
    // Gate-03 TASK 1: directive z_reports columns on pre-existing DBs.
    'ALTER TABLE z_reports ADD COLUMN day TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE z_reports ADD COLUMN opening_time TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE z_reports ADD COLUMN closing_time TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE z_reports ADD COLUMN total_sales_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE z_reports ADD COLUMN especes_gross_ct INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE z_reports ADD COLUMN cib_total_ct INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE z_reports ADD COLUMN dahabiya_total_ct INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE z_reports ADD COLUMN credit_granted_ct INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE z_reports ADD COLUMN credit_collected_ct INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE z_reports ADD COLUMN first_invoice_number TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE z_reports ADD COLUMN last_invoice_number TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE z_reports ADD COLUMN prev_hash TEXT NOT NULL DEFAULT \'\'',
    // ADR-014-MKT: manager-override audit columns on pre-existing void_log.
    'ALTER TABLE void_log ADD COLUMN action_type TEXT',
    'ALTER TABLE void_log ADD COLUMN product_id INTEGER',
    'ALTER TABLE void_log ADD COLUMN product_name TEXT',
    'ALTER TABLE void_log ADD COLUMN amount_ct INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE void_log ADD COLUMN cashier_name TEXT',
    'ALTER TABLE void_log ADD COLUMN manager_name TEXT',
    'ALTER TABLE void_log ADD COLUMN session_id TEXT',
    'ALTER TABLE void_log ADD COLUMN created_at TEXT',
  ]) {
    try { db.exec(ddl); } catch { /* column already exists */ }
  }
  // Migrate old seq CHECK (FACT,T[,Q]) -> (FACT,T,Q,Z) for Z-report numbers.
  try {
    const seqSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'seq'").get() as { sql: string }).sql ?? '';
    if (!seqSql.includes("'Z'")) {
      db.exec(`CREATE TABLE IF NOT EXISTS seq_new (
        kind TEXT NOT NULL CHECK (kind IN ('FACT', 'T', 'Q', 'Z')),
        year INTEGER NOT NULL, last_n INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (kind, year))`);
      db.exec('INSERT OR IGNORE INTO seq_new (kind, year, last_n) SELECT kind, year, last_n FROM seq');
      db.exec('DROP TABLE seq');
      db.exec('ALTER TABLE seq_new RENAME TO seq');
    }
  } catch { /* fresh DB already has Q */ }
  // T3 foundation (ADR-021): climb older files to LATEST_SCHEMA_VERSION.
  migrateSchemaVersion(db);
  // A2: post-migration index pass — every column now exists. Fail hard: a
  // broken index at this point is genuine corruption, never legacy shape.
  for (const ix of schemaIndexes) db.exec(ix);
  // TASK-BRK-016-MKT: seed the Algerian reference catalog once (idempotent —
  // pre-seeded DBs are detected by row count, never re-inserted).
  try {
    const seeded = (db.prepare('SELECT COUNT(*) AS n FROM ref_categories').get() as { n: number }).n;
    if (seeded === 0) {
      const { cats, templates } = loadReferenceCatalog();
      const tx = db.prepare(
        'INSERT INTO ref_categories (code, name_fr, name_ar, default_tva) VALUES (?, ?, ?, ?)');
      const tt = db.prepare(
        `INSERT INTO ref_templates (brand_id, brand_name, brand_name_ar, manufacturer,
          category_code, suggested_name_fr, suggested_name_ar, search_aliases, is_weighable, default_unit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const c of cats) tx.run(c.code, c.nameFr, c.nameAr, c.defaultTva);
        for (const t of templates) {
          tt.run(t.brandId, t.brandName, t.brandNameAr, t.manufacturer, t.categoryCode,
            t.suggestedNameFr, t.suggestedNameAr, t.searchAliases, t.isWeighable ? 1 : 0, t.defaultUnit);
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  } catch { /* tables missing on exotic pre-seeds — search falls back to JSON */ }

  const pragmas = () => ({
    journal_mode: (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode,
    foreign_keys: (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys,
  });

  const timbreProfile = () => {
    const row = db.prepare('SELECT timbre_rate, timbre_min_ct, timbre_max_ct FROM store_profile WHERE id = 1').get() as
      | { timbre_rate: number; timbre_min_ct: number; timbre_max_ct: number }
      | undefined;
    if (!row) return {};
    return {
      timbre_rate: row.timbre_rate,
      timbre_min: row.timbre_min_ct / 100,
      timbre_max: row.timbre_max_ct / 100,
    };
  };

  return {
    db,

    close() {
      db.close();
    },

    pragmas,

    upsertProduct(p: ProductRow) {
      assertTvaRate(p.tva_rate);
      assertIntegerCentimes(p.buy_price_ct, 'buy_price_ct');
      assertIntegerCentimes(p.sell_price_ct, 'sell_price_ct');
      assertIntegerCentimes(p.stock_milli, 'stock_milli');
      assertIntegerCentimes(p.min_stock_milli, 'min_stock_milli');
      db.prepare(
        `INSERT INTO products (id, barcode, name_fr, name_ar, category_id, buy_price_ct, sell_price_ct,
          tva_rate, stock_milli, min_stock_milli, unit, is_scale, scale_item_code, has_expiry, expiry_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET barcode=excluded.barcode, name_fr=excluded.name_fr,
           name_ar=excluded.name_ar, category_id=excluded.category_id, buy_price_ct=excluded.buy_price_ct,
           sell_price_ct=excluded.sell_price_ct, tva_rate=excluded.tva_rate, stock_milli=excluded.stock_milli,
           min_stock_milli=excluded.min_stock_milli, unit=excluded.unit, is_scale=excluded.is_scale,
           scale_item_code=excluded.scale_item_code, has_expiry=excluded.has_expiry, expiry_date=excluded.expiry_date`,
      ).run(
        p.id, p.barcode, p.name_fr, p.name_ar, p.category_id, p.buy_price_ct, p.sell_price_ct,
        p.tva_rate, p.stock_milli, p.min_stock_milli, p.unit, p.is_scale, p.scale_item_code,
        p.has_expiry, p.expiry_date,
      );
    },

    getProduct(id: number): ProductRow {
      const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
      if (!row) throw new Error(`[db] product not found: ${id}`);
      return row;
    },

    addProductBarcode(input: { product_id: number; barcode: string; multiplier?: number; pack_name?: string | null; price_override_ct?: number | null }): number {
      const multiplier = input.multiplier ?? 1;
      const code = input.barcode.trim();
      if (!code) throw new Error('[db] barcode must not be empty');
      if (!Number.isInteger(multiplier) || multiplier < 1) throw new Error(`[db] multiplier must be >= 1 (got ${multiplier})`);
      if (input.price_override_ct !== undefined && input.price_override_ct !== null) {
        assertIntegerCentimes(input.price_override_ct, 'price_override_ct');
      }
      const res = db.prepare(
        `INSERT INTO product_barcodes (product_id, barcode, multiplier, pack_name, price_override_ct)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(input.product_id, code, multiplier, input.pack_name ?? null, input.price_override_ct ?? null);
      return Number(res.lastInsertRowid);
    },

    getProductBarcodes(productId: number): ProductBarcodeRecord[] {
      return db.prepare('SELECT * FROM product_barcodes WHERE product_id = ? ORDER BY id').all(productId) as unknown as ProductBarcodeRecord[];
    },

    deleteProductBarcode(id: number): void {
      db.prepare('DELETE FROM product_barcodes WHERE id = ?').run(id);
    },

    resolveBarcode(barcode: string): ProductBarcodeResolution | null {
      const code = barcode.trim();
      if (!code) return null;
      const prod = db.prepare('SELECT * FROM products WHERE barcode = ?').get(code) as ProductRow | undefined;
      if (prod) {
        return { product: prod, isPack: false, multiplier: 1, effectivePriceCt: prod.sell_price_ct, barcode: code };
      }
      const alias = db.prepare('SELECT * FROM product_barcodes WHERE barcode = ?').get(code) as ProductBarcodeRecord | undefined;
      if (!alias) return null;
      const parent = db.prepare('SELECT * FROM products WHERE id = ?').get(alias.product_id) as ProductRow | undefined;
      if (!parent) return null;
      return {
        product: parent,
        isPack: alias.multiplier > 1,
        multiplier: alias.multiplier,
        packName: alias.pack_name ?? undefined,
        effectivePriceCt: effectivePackPriceCt(parent.sell_price_ct, alias.multiplier, alias.price_override_ct),
        barcode: code,
      };
    },

    recordInventoryLoss(input: RecordLossInput): { id: number; stock_milli: number } {
      assertLossReason(input.reason);
      if (!Number.isInteger(input.qty_milli) || input.qty_milli <= 0) {
        throw new Error(`[db] loss qty_milli must be a positive integer (got ${input.qty_milli})`);
      }
      const unitCostCt = input.unit_cost_ct ?? 0;
      assertIntegerCentimes(unitCostCt, 'unit_cost_ct');
      if (unitCostCt < 0) throw new Error(`[db] unit_cost_ct must be >= 0 (got ${unitCostCt})`);
      const totalLossCt = input.total_loss_ct ?? Math.round((unitCostCt * input.qty_milli) / 1000);
      assertIntegerCentimes(totalLossCt, 'total_loss_ct');
      // BEGIN IMMEDIATE: ledger row + stock decrement commit atomically.
      db.exec('BEGIN IMMEDIATE');
      try {
        const prod = db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(input.product_id) as
          | { stock_milli: number }
          | undefined;
        if (!prod) throw new Error(`[db] loss target product not found: ${input.product_id}`);
        if (input.qty_milli > prod.stock_milli) {
          throw new Error(`[db] loss qty ${input.qty_milli} exceeds stock ${prod.stock_milli} (product ${input.product_id})`);
        }
        const res = db.prepare(
          `INSERT INTO inventory_losses (product_id, qty_milli, reason, unit_cost_ct, total_loss_ct, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.product_id, input.qty_milli, input.reason, unitCostCt, totalLossCt,
          input.notes ?? null, input.created_at ?? new Date().toISOString(),
        );
        db.prepare('UPDATE products SET stock_milli = stock_milli - ? WHERE id = ?').run(input.qty_milli, input.product_id);
        db.exec('COMMIT');
        const row = db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(input.product_id) as { stock_milli: number };
        return { id: Number(res.lastInsertRowid), stock_milli: row.stock_milli };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },

    getInventoryLosses(q?: LossQuery): InventoryLoss[] {
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (q?.reason) { assertLossReason(q.reason); where.push('reason = ?'); args.push(q.reason); }
      if (q?.product_id !== undefined) { where.push('product_id = ?'); args.push(q.product_id); }
      if (q?.from) { where.push('created_at >= ?'); args.push(q.from); }
      if (q?.to) { where.push('created_at <= ?'); args.push(q.to); }
      const limit = q?.limit ?? 200;
      if (!Number.isInteger(limit) || limit <= 0) throw new Error(`[db] loss query limit must be > 0 (got ${limit})`);
      const sql = `SELECT * FROM inventory_losses${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`;
      return db.prepare(sql).all(...args, limit) as unknown as InventoryLoss[];
    },

    getExpiringProducts(daysThreshold: number): ProductRow[] {
      if (!Number.isInteger(daysThreshold) || daysThreshold < 0) {
        throw new Error(`[db] daysThreshold must be a non-negative integer (got ${daysThreshold})`);
      }
      return db.prepare(
        `SELECT * FROM products
          WHERE has_expiry = 1 AND expiry_date IS NOT NULL AND expiry_date <> ''
            AND date(expiry_date) <= date('now', '+' || ? || ' days')
          ORDER BY date(expiry_date) ASC`,
      ).all(daysThreshold) as unknown as ProductRow[];
    },

    importProductsBatch(rows: ImportProductRow[], mode: 'INSERT_ONLY' | 'UPSERT'): BatchImportResult {
      if (mode !== 'INSERT_ONLY' && mode !== 'UPSERT') throw new Error(`[db] import mode must be INSERT_ONLY|UPSERT (got ${mode})`);
      const out: BatchImportResult = { inserted: 0, updated: 0, failed: 0 };
      if (rows.length === 0) return out;
      const assertUnit = (u: string): void => {
        if (u !== 'PIECE' && u !== 'KG' && u !== 'LITRE') throw new Error(`[db] import unit must be PIECE|KG|LITRE (got ${u})`);
      };
      db.exec('BEGIN IMMEDIATE');
      try {
        const exists = db.prepare('SELECT id FROM products WHERE barcode = ?');
        const insIgnore = db.prepare(
          `INSERT OR IGNORE INTO products (barcode, name_fr, buy_price_ct, sell_price_ct, tva_rate, stock_milli, category_id, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        // Adapted to the real schema (sell_price_ct / name_fr / category_id).
        const upsert = db.prepare(
          `INSERT INTO products (barcode, name_fr, buy_price_ct, sell_price_ct, tva_rate, stock_milli, category_id, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (barcode) DO UPDATE SET
             name_fr = excluded.name_fr,
             buy_price_ct = excluded.buy_price_ct,
             sell_price_ct = excluded.sell_price_ct,
             tva_rate = excluded.tva_rate,
             stock_milli = products.stock_milli + excluded.stock_milli,
             category_id = excluded.category_id,
             unit = excluded.unit`,
        );
        for (const r of rows) {
          try {
            const code = r.barcode.trim();
            if (!code) throw new Error('barcode must not be empty');
            assertTvaRate(r.tvaRate);
            assertUnit(r.unit);
            assertIntegerCentimes(r.buyPriceCt, 'buyPriceCt');
            assertIntegerCentimes(r.priceCt, 'priceCt');
            assertIntegerCentimes(r.stockMilli, 'stockMilli');
            if (r.buyPriceCt < 0 || r.priceCt < 0 || r.stockMilli < 0) throw new Error('import money/qty must be >= 0');
            const args = [code, r.name.trim(), r.buyPriceCt, r.priceCt, r.tvaRate, r.stockMilli, r.category.trim() || 'Général', r.unit] as const;
            if (mode === 'UPSERT') {
              const had = exists.get(code) !== undefined;
              upsert.run(...args);
              if (had) out.updated += 1; else out.inserted += 1;
            } else {
              const res = insIgnore.run(...args);
              if (Number(res.changes) === 1) out.inserted += 1;
              else out.failed += 1;
            }
          } catch (e) {
            if (mode === 'UPSERT') throw e;
            out.failed += 1;
          }
        }
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },

    receiveSupplierDelivery(payload: SupplierDeliveryReceipt): DeliveryReceiptResult {
      if (!Array.isArray(payload.items) || payload.items.length === 0) {
        throw new Error('[db] delivery must contain at least one item');
      }
      const method = payload.paymentMethod ?? 'ESPECES';
      if (method !== 'ESPECES' && method !== 'VIREMENT' && method !== 'CHEQUE') {
        throw new Error(`[db] delivery payment method must be ESPECES|VIREMENT|CHEQUE (got ${method})`);
      }
      assertIntegerCentimes(payload.paidAmountCt, 'paidAmountCt');
      if (payload.paidAmountCt < 0) throw new Error('[db] paidAmountCt must be >= 0');
      const date = payload.date ?? new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(payload.supplierId) as
          | { id: number; name: string }
          | undefined;
        if (!supplier) throw new Error(`[db] supplier not found: ${payload.supplierId}`);
        // Line math in integer centimes: HT per base unit x units; TVA rounds half-up.
        let totalHt = 0, totalTva = 0;
        const lines: {
          product: ProductRow; units: number; qtyMilli: number; rate: TVARate;
          lineHt: number; lineTva: number; lineTtc: number; tvaRate: TVARate;
        }[] = [];
        for (const it of payload.items) {
          const mult = it.packMultiplier ?? 1;
          if (!Number.isInteger(mult) || mult < 1) throw new Error(`[db] packMultiplier must be >= 1 (got ${mult})`);
          if (!Number.isInteger(it.packCount) || it.packCount <= 0) {
            throw new Error(`[db] packCount must be a positive integer (got ${it.packCount})`);
          }
          assertIntegerCentimes(it.unitCostCt, 'unitCostCt');
          if (it.unitCostCt < 0) throw new Error('[db] unitCostCt must be >= 0');
          const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.productId) as ProductRow | undefined;
          if (!product) throw new Error(`[db] delivery product not found: ${it.productId}`);
          const rate: TVARate = it.tvaRate ?? product.tva_rate;
          assertTvaRate(rate);
          const units = it.packCount * mult;
          const expectedTotal = units * it.unitCostCt;
          if (it.totalCostCt !== undefined) {
            assertIntegerCentimes(it.totalCostCt, 'totalCostCt');
            if (it.totalCostCt !== expectedTotal) {
              throw new Error(`[db] totalCostCt ${it.totalCostCt} != packCount x multiplier x unitCost ${expectedTotal}`);
            }
          }
          if (it.updateSellPriceCt !== undefined) assertIntegerCentimes(it.updateSellPriceCt, 'updateSellPriceCt');
          const lineHt = expectedTotal;
          const lineTva = Math.round((lineHt * rate) / 100);
          lines.push({ product, units, qtyMilli: units * 1000, rate, lineHt, lineTva, lineTtc: lineHt + lineTva, tvaRate: rate });
          totalHt += lineHt;
          totalTva += lineTva;
        }
        const totalTtc = totalHt + totalTva;
        if (payload.paidAmountCt > totalTtc) {
          throw new Error(`[db] paidAmountCt ${payload.paidAmountCt} exceeds delivery total ${totalTtc}`);
        }
        const remaining = totalTtc - payload.paidAmountCt;
        const purchaseId = randomUUID();
        const invoiceNumber = payload.invoiceRef?.trim() || `BL-${new Date(date).getFullYear()}-${purchaseId.slice(0, 8).toUpperCase()}`;
        db.prepare(
          `INSERT INTO purchases (id, invoice_number, supplier_id, supplier_name, total_ht_ct, total_tva_ct,
            total_ttc_ct, payment_method, amount_paid_ct, amount_due_ct, date, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          purchaseId, invoiceNumber, payload.supplierId, supplier.name, totalHt, totalTva,
          totalTtc, remaining === 0 ? method : 'CREDIT', payload.paidAmountCt, remaining, date,
          payload.notes ?? null,
        );
        const insItem = db.prepare(
          `INSERT INTO purchase_items (purchase_id, product_id, barcode, name_fr, name_ar, qty_milli, unit,
            unit_buy_price_ht_ct, tva_rate, unit_sell_price_ttc_ct, line_ht_ct, line_ttc_ct)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const updProduct = db.prepare(
          `UPDATE products SET stock_milli = stock_milli + ?, buy_price_ct = ?,
             sell_price_ct = COALESCE(?, sell_price_ct) WHERE id = ?`,
        );
        for (let k = 0; k < payload.items.length; k++) {
          const it = payload.items[k];
          const ln = lines[k];
          insItem.run(
            purchaseId, ln.product.id, ln.product.barcode, ln.product.name_fr, ln.product.name_ar,
            ln.qtyMilli, ln.product.unit, it.unitCostCt, ln.tvaRate,
            it.updateSellPriceCt ?? ln.product.sell_price_ct, ln.lineHt, ln.lineTtc,
          );
          updProduct.run(ln.qtyMilli, it.unitCostCt, it.updateSellPriceCt ?? null, ln.product.id);
        }
        if (payload.paidAmountCt > 0) {
          db.prepare(
            `INSERT INTO supplier_payments (id, supplier_id, supplier_name, amount_ct, payment_method, reference, date, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(randomUUID(), payload.supplierId, supplier.name, payload.paidAmountCt, method, invoiceNumber, date, payload.notes ?? null);
        }
        if (remaining > 0) {
          db.prepare('UPDATE suppliers SET balance_due_ct = balance_due_ct + ? WHERE id = ?').run(remaining, payload.supplierId);
        }
        db.exec('COMMIT');
        return {
          purchaseId, totalCostCt: totalTtc, paidAmountCt: payload.paidAmountCt,
          remainingDebtCt: remaining, itemsProcessed: lines.length,
        };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },

    getSupplierPurchases(supplierId: number, limit?: number): Record<string, unknown>[] {
      const lim = limit ?? 50;
      if (!Number.isInteger(lim) || lim <= 0) throw new Error(`[db] purchases limit must be > 0 (got ${lim})`);
      return db.prepare(
        'SELECT * FROM purchases WHERE supplier_id = ? ORDER BY date DESC, id DESC LIMIT ?',
      ).all(supplierId, lim) as unknown as Record<string, unknown>[];
    },

    getSupplierBalanceStatement(supplierId: number): SupplierStatement {
      const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId) as
        | { id: number; name: string; balance_due_ct: number }
        | undefined;
      if (!supplier) throw new Error(`[db] supplier not found: ${supplierId}`);
      const purchased = db.prepare('SELECT COALESCE(SUM(total_ttc_ct), 0) AS t FROM purchases WHERE supplier_id = ?').get(supplierId) as { t: number };
      const paid = db.prepare('SELECT COALESCE(SUM(amount_ct), 0) AS t FROM supplier_payments WHERE supplier_id = ?').get(supplierId) as { t: number };
      return {
        supplierId: supplier.id, supplierName: supplier.name,
        totalPurchasedCt: purchased.t, totalPaidCt: paid.t,      outstandingCt: supplier.balance_due_ct,
      };
    },

    settleClientCredit(payload: ClientSettlementPayload): ClientSettlementResult {
      assertIntegerCentimes(payload.amountCt, 'amountCt');
      if (payload.amountCt <= 0) throw new Error('[db] settlement amount must be > 0');
      const method: PaymentMethod = payload.paymentMethod ?? 'ESPECES';
      if (method !== 'ESPECES' && method !== 'CIB' && method !== 'DAHABIYA' && method !== 'CREDIT') {
        throw new Error(`[db] settlement method must be ESPECES|CIB|DAHABIYA|CREDIT (got ${method})`);
      }
      const date = payload.date ?? new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const client = db.prepare(
          'SELECT id, name, phone, credit_balance_ct, max_credit_limit_ct FROM clients WHERE id = ?',
        ).get(payload.clientId) as
          | { id: number; name: string; phone: string; credit_balance_ct: number; max_credit_limit_ct: number }
          | undefined;
        if (!client) throw new Error(`[db] CLIENT_NOT_FOUND: ${payload.clientId}`);
        // Art.136: cash (ESPECES) inflows >= 50 DZD carry stamp duty.
        const timbreCt = calculateTimbreFiscalCt(payload.amountCt, method, timbreProfile());
        const collectedCt = payload.amountCt + timbreCt;
        const newBalance = client.credit_balance_ct - payload.amountCt;
        db.prepare('UPDATE clients SET credit_balance_ct = ? WHERE id = ?').run(newBalance, client.id);
        const id = randomUUID();
        const year = parseInt(date.slice(0, 4), 10);
        const receipt = `Q-${year}-${pad6(bumpSeq(db, 'Q', year))}`;
        db.prepare(
          `INSERT INTO client_settlements (id, client_id, client_name, amount_ct, payment_method,
            timbre_ct, total_collected_ct, receipt_number, date, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, client.id, client.name, payload.amountCt, method,
          timbreCt, collectedCt, receipt, date, payload.notes ?? null,
        );
        db.exec('COMMIT');
        return {
          settlementId: id, receiptNumber: receipt, clientId: client.id, clientName: client.name,
          clientPhone: client.phone || undefined, previousBalanceCt: client.credit_balance_ct,
          paidAmountCt: payload.amountCt, timbreCt, totalCollectedCt: collectedCt,
          newBalanceCt: newBalance, paymentMethod: method,
          cashierName: payload.cashierName, createdAt: date,
        };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },

    checkCreditEligibility(clientId: number, saleTotalTtcCt: number): CreditEligibility {
      assertIntegerCentimes(saleTotalTtcCt, 'saleTotalTtcCt');
      if (saleTotalTtcCt < 0) throw new Error('[db] saleTotalTtcCt must be >= 0');
      const client = db.prepare(
        'SELECT credit_balance_ct, max_credit_limit_ct FROM clients WHERE id = ?',
      ).get(clientId) as { credit_balance_ct: number; max_credit_limit_ct: number } | undefined;
      if (!client) throw new Error(`[db] CLIENT_NOT_FOUND: ${clientId}`);
      const projected = client.credit_balance_ct + saleTotalTtcCt;
      if (client.max_credit_limit_ct > 0 && projected > client.max_credit_limit_ct) {
        return {
          allowed: false, currentBalanceCt: client.credit_balance_ct,
          maxCreditCt: client.max_credit_limit_ct, projectedBalanceCt: projected,
          reason: 'CREDIT_LIMIT_EXCEEDED',
        };
      }
      return {
        allowed: true, currentBalanceCt: client.credit_balance_ct,
        maxCreditCt: client.max_credit_limit_ct, projectedBalanceCt: projected,
      };
    },

    getClientStatement(clientId: number) {
      const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as
        | Record<string, unknown>
        | undefined;
      if (!client) throw new Error(`[db] CLIENT_NOT_FOUND: ${clientId}`);
      const settlements = db.prepare(
        'SELECT * FROM client_settlements WHERE client_id = ? ORDER BY date DESC, id DESC',
      ).all(clientId) as unknown as Record<string, unknown>[];
      const creditSales = db.prepare(
        "SELECT * FROM sales WHERE client_id = ? AND payment_method = 'CREDIT' ORDER BY created_at DESC, id DESC",
      ).all(clientId) as unknown as Record<string, unknown>[];
      return { client, settlements, creditSales };
    },

    openCashSession(cashierName: string, openingFloatCt: number): CashSessionRecord {
      const name = cashierName?.trim();
      if (!name) throw new Error('[db] cashierName must be non-empty');
      assertIntegerCentimes(openingFloatCt, 'openingFloatCt');
      if (openingFloatCt < 0) throw new Error('[db] openingFloatCt must be >= 0');
      const open = db.prepare("SELECT id FROM cash_sessions WHERE status = 'OPEN' LIMIT 1").get() as
        | { id: string }
        | undefined;
      if (open) throw new Error(`[db] cash session already OPEN: ${open.id}`);
      const id = randomUUID();
      const openedAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO cash_sessions (id, cashier_name, opened_at, opening_float_ct, status)
         VALUES (?, ?, ?, ?, 'OPEN')`,
      ).run(id, name, openedAt, openingFloatCt);
      return {
        id, cashierName: name, openedAt, openingFloatCt, status: 'OPEN',
      };
    },

    recordCashMovement(
      sessionId: string, type: CashMovementType, amountCt: number, reason: string,
    ): Record<string, unknown> {
      if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL' && type !== 'EXPENSE') {
        throw new Error(`[db] movement type must be DEPOSIT|WITHDRAWAL|EXPENSE (got ${type})`);
      }
      assertIntegerCentimes(amountCt, 'amountCt');
      if (amountCt <= 0) throw new Error('[db] movement amount must be > 0');
      if (!reason?.trim()) throw new Error('[db] movement reason must be non-empty');
      const session = db.prepare('SELECT id, status FROM cash_sessions WHERE id = ?').get(sessionId) as
        | { id: string; status: string }
        | undefined;
      if (!session) throw new Error(`[db] cash session not found: ${sessionId}`);
      if (session.status !== 'OPEN') throw new Error(`[db] cash session is ${session.status}: ${sessionId}`);
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO cash_movements (id, session_id, movement_type, amount_ct, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, sessionId, type, amountCt, reason.trim(), createdAt);
      return { id, session_id: sessionId, movement_type: type, amount_ct: amountCt, reason: reason.trim(), created_at: createdAt };
    },

    getCashSessionStatus(sessionId: string): CashSessionLiveStatus {
      const s = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(sessionId) as
        | {
          id: string; cashier_name: string; opened_at: string; closed_at: string | null;
          opening_float_ct: number; closing_counted_ct: number | null;
          theoretical_cash_ct: number | null; cash_diff_ct: number | null;
          status: string; z_report_id: string | null; notes: string | null;
        }
        | undefined;
      if (!s) throw new Error(`[db] cash session not found: ${sessionId}`);
      const session: CashSessionRecord = {
        id: s.id, cashierName: s.cashier_name, openedAt: s.opened_at,
        closedAt: s.closed_at ?? undefined, openingFloatCt: s.opening_float_ct,
        closingCountedCt: s.closing_counted_ct ?? undefined,
        theoreticalCashCt: s.theoretical_cash_ct ?? undefined,
        cashDiffCt: s.cash_diff_ct ?? undefined,
        status: s.status as 'OPEN' | 'CLOSED', zReportId: s.z_report_id ?? undefined,
        notes: s.notes ?? undefined,
      };
      const end = s.status === 'OPEN' ? new Date().toISOString() : (s.closed_at as string);
      const sales = db.prepare(
        `SELECT COUNT(*) AS n,
           COALESCE(SUM(CASE WHEN payment_method = 'ESPECES' THEN total_ttc_ct ELSE 0 END), 0) AS cash,
           COALESCE(SUM(CASE WHEN payment_method = 'CIB' THEN total_ttc_ct ELSE 0 END), 0) AS cib,
           COALESCE(SUM(CASE WHEN payment_method = 'DAHABIYA' THEN total_ttc_ct ELSE 0 END), 0) AS dah,
           COALESCE(SUM(CASE WHEN payment_method = 'CREDIT' THEN total_ttc_ct ELSE 0 END), 0) AS cred
         FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at <= ?`,
      ).get(s.opened_at, end) as { n: number; cash: number; cib: number; dah: number; cred: number };
      const settled = db.prepare(
        `SELECT COALESCE(SUM(total_collected_ct), 0) AS t FROM client_settlements
         WHERE payment_method = 'ESPECES' AND date >= ? AND date <= ?`,
      ).get(s.opened_at, end) as { t: number };
      const moves = db.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN movement_type = 'DEPOSIT' THEN amount_ct ELSE 0 END), 0) AS dep,
           COALESCE(SUM(CASE WHEN movement_type = 'WITHDRAWAL' THEN amount_ct ELSE 0 END), 0) AS wit,
           COALESCE(SUM(CASE WHEN movement_type = 'EXPENSE' THEN amount_ct ELSE 0 END), 0) AS exp
         FROM cash_movements WHERE session_id = ?`,
      ).get(sessionId) as { dep: number; wit: number; exp: number };
      const theoretical = s.opening_float_ct + sales.cash + settled.t + moves.dep - moves.wit - moves.exp;
      return {
        session, openingFloatCt: s.opening_float_ct, cashSalesCt: sales.cash,
        settlementsCashCt: settled.t, depositsCt: moves.dep, withdrawalsCt: moves.wit,
        expensesCt: moves.exp, theoreticalCashCt: theoretical, totalSalesCount: sales.n,
      };
    },

    getActiveCashSession(): CashSessionLiveStatus | null {
      const open = db.prepare("SELECT id FROM cash_sessions WHERE status = 'OPEN' LIMIT 1").get() as
        | { id: string }
        | undefined;
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      return open ? (this as unknown as BarakaDb).getCashSessionStatus(open.id) : null;
    },

    // Clôture rebuild (v1.4.5): newest-first session history for the page.
    listCashSessions(limit?: number): CashSessionRecord[] {
      const n = Math.min(Math.max(Math.floor(limit ?? 20) || 20, 1), 100);
      const rows = db.prepare(
        `SELECT id, cashier_name, opened_at, closed_at, opening_float_ct,
           closing_counted_ct, theoretical_cash_ct, cash_diff_ct, status,
           z_report_id, notes
         FROM cash_sessions ORDER BY opened_at DESC LIMIT ?`,
      ).all(n) as {
        id: string; cashier_name: string; opened_at: string; closed_at: string | null;
        opening_float_ct: number; closing_counted_ct: number | null;
        theoretical_cash_ct: number | null; cash_diff_ct: number | null;
        status: string; z_report_id: string | null; notes: string | null;
      }[];
      return rows.map(r => ({
        id: r.id, cashierName: r.cashier_name, openedAt: r.opened_at,
        closedAt: r.closed_at ?? undefined, openingFloatCt: r.opening_float_ct,
        closingCountedCt: r.closing_counted_ct ?? undefined,
        theoreticalCashCt: r.theoretical_cash_ct ?? undefined,
        cashDiffCt: r.cash_diff_ct ?? undefined,
        status: r.status as 'OPEN' | 'CLOSED', zReportId: r.z_report_id ?? undefined,
        notes: r.notes ?? undefined,
      }));
    },

    closeCashSessionAndGenerateZ(sessionId: string, countedCashCt: number, notes?: string): ZClosureResult {
      assertIntegerCentimes(countedCashCt, 'countedCashCt');
      if (countedCashCt < 0) throw new Error('[db] countedCashCt must be >= 0');
      db.exec('BEGIN IMMEDIATE');
      try {
        const s = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(sessionId) as
          | { id: string; cashier_name: string; opened_at: string; opening_float_ct: number; status: string }
          | undefined;
        if (!s) throw new Error(`[db] cash session not found: ${sessionId}`);
        if (s.status !== 'OPEN') throw new Error(`[db] cash session already ${s.status}: ${sessionId}`);
        const periodEnd = new Date().toISOString();
        // #004: a legally closed day is frozen — no shift may post to it.
        if (isDayLocked(db, periodEnd.slice(0, 10))) {
          throw new Error(`[db] day ${periodEnd.slice(0, 10)} is already legally closed (Z FINALISÉ) — shift close refused`);
        }
        const agg = db.prepare(
          `SELECT COUNT(*) AS n,
             COALESCE(SUM(total_ht_ct), 0) AS ht,
             COALESCE(SUM(tva9_base_ct), 0) AS b9, COALESCE(SUM(tva9_amt_ct), 0) AS a9,
             COALESCE(SUM(tva19_base_ct), 0) AS b19, COALESCE(SUM(tva19_amt_ct), 0) AS a19,
             COALESCE(SUM(timbre_ct), 0) AS timbre,
             COALESCE(SUM(total_ttc_ct), 0) AS ttc,
             COALESCE(SUM(CASE WHEN payment_method = 'ESPECES' THEN total_ttc_ct ELSE 0 END), 0) AS cash,
             COALESCE(SUM(CASE WHEN payment_method = 'CIB' THEN total_ttc_ct ELSE 0 END), 0) AS cib,
             COALESCE(SUM(CASE WHEN payment_method = 'DAHABIYA' THEN total_ttc_ct ELSE 0 END), 0) AS dah,
             COALESCE(SUM(CASE WHEN payment_method = 'CREDIT' THEN total_ttc_ct ELSE 0 END), 0) AS cred,
             MIN(invoice_number) AS first, MAX(invoice_number) AS last
           FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at <= ?`,
        ).get(s.opened_at, periodEnd) as {
          n: number; ht: number; b9: number; a9: number; b19: number; a19: number;
          timbre: number; ttc: number; cash: number; cib: number; dah: number; cred: number;
          first: string | null; last: string | null;
        };
        const settled = db.prepare(
          `SELECT COALESCE(SUM(total_collected_ct), 0) AS t FROM client_settlements
           WHERE payment_method = 'ESPECES' AND date >= ? AND date <= ?`,
        ).get(s.opened_at, periodEnd) as { t: number };
        const moves = db.prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN movement_type = 'DEPOSIT' THEN amount_ct ELSE 0 END), 0) AS dep,
             COALESCE(SUM(CASE WHEN movement_type = 'WITHDRAWAL' THEN amount_ct ELSE 0 END), 0) AS wit,
             COALESCE(SUM(CASE WHEN movement_type = 'EXPENSE' THEN amount_ct ELSE 0 END), 0) AS exp
           FROM cash_movements WHERE session_id = ?`,
        ).get(sessionId) as { dep: number; wit: number; exp: number };
        const theoretical = s.opening_float_ct + agg.cash + settled.t + moves.dep - moves.wit - moves.exp;
        const diff = countedCashCt - theoretical;
        // Fiscal Z (hash-chained, gapless) — same statements as finalizeZReport, inside this txn.
        const day = periodEnd.slice(0, 10);
        const year = parseInt(day.slice(0, 4), 10);
        const prevRow = db.prepare('SELECT hash FROM z_reports ORDER BY rowid DESC LIMIT 1').get() as
          | { hash: string }
          | undefined;
        const prev = prevRow?.hash ?? GENESIS_Z_HASH;
        const zNumber = `Z-${year}-${pad6(bumpSeq(db, 'Z', year))}`;
        const hash = computeZHashDb(prev, zNumber, day, agg.ttc, agg.timbre);
        db.prepare(
          `INSERT INTO z_reports (report_number, day, opening_time, closing_time,
            total_sales_count, total_ht_ct, tva0_base_ct, tva9_base_ct, tva9_amt_ct,
            tva19_base_ct, tva19_amt_ct, total_tva_ct, total_timbre_ct, total_ttc_ct,
            especes_gross_ct, cib_total_ct, dahabiya_total_ct, credit_granted_ct,
            credit_collected_ct, first_invoice_number, last_invoice_number,
            prev_hash, hash, finalized, close_kind)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'SHIFT')`,
        ).run(
          zNumber, day, s.opened_at, periodEnd,
          agg.n, agg.ht, agg.b9, agg.a9, agg.b19, agg.a19, agg.a9 + agg.a19,
          agg.timbre, agg.ttc, agg.cash, agg.cib, agg.dah, agg.cred, settled.t,
          agg.first ?? '', agg.last ?? '', prev, hash,
        );
        db.prepare(
          `UPDATE cash_sessions SET status = 'CLOSED', closed_at = ?, closing_counted_ct = ?,
             theoretical_cash_ct = ?, cash_diff_ct = ?, z_report_id = ?, notes = COALESCE(?, notes)
           WHERE id = ?`,
        ).run(periodEnd, countedCashCt, theoretical, diff, zNumber, notes ?? null, sessionId);
        db.exec('COMMIT');
        return {
          zNumber, sessionId, cashierName: s.cashier_name, periodStart: s.opened_at, periodEnd,
          totalHtCt: agg.ht, totalTva9Ct: agg.a9, totalTva19Ct: agg.a19, totalTimbreCt: agg.timbre,
          totalTtcCt: agg.ttc, salesCount: agg.n, cashSalesCt: agg.cash, cibSalesCt: agg.cib,
          dahabiyaSalesCt: agg.dah, creditSalesCt: agg.cred, settlementsCashCt: settled.t,
          depositsCt: moves.dep, withdrawalsCt: moves.wit, expensesCt: moves.exp,
          openingFloatCt: s.opening_float_ct, theoreticalCashCt: theoretical,
          closingCountedCt: countedCashCt, cashDiffCt: diff, hash, prevHash: prev,
        };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },

    recordVoidLog(entry: VoidLogEntry): VoidLogRecord {
      const valid: ProtectedActionType[] = ['LINE_VOID', 'CART_CLEAR', 'MANUAL_DISCOUNT', 'DRAWER_KICK'];
      if (!valid.includes(entry.actionType)) {
        throw new Error(`[db] void action must be LINE_VOID|CART_CLEAR|MANUAL_DISCOUNT|DRAWER_KICK (got ${entry.actionType})`);
      }
      assertIntegerCentimes(entry.amountCt, 'amountCt');
      if (entry.amountCt < 0) throw new Error('[db] void amountCt must be >= 0');
      if (!entry.cashierName?.trim()) throw new Error('[db] void cashierName is required');
      if (!entry.reason?.trim()) throw new Error('[db] void reason is required');
      const createdAt = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = db.prepare(
          `INSERT INTO void_log (action_type, product_id, product_name, amount_ct,
            cashier_name, manager_name, reason, session_id, voided_by, voided_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          entry.actionType, entry.productId ?? null, entry.productName ?? null, entry.amountCt,
          entry.cashierName.trim(), entry.managerApprovedBy?.trim() ?? null, entry.reason.trim(),
          entry.sessionId ?? null, entry.cashierName.trim(), createdAt, createdAt,
        );
        db.exec('COMMIT');
        return {
          ...entry, id: String(r.lastInsertRowid),
          cashierName: entry.cashierName.trim(), reason: entry.reason.trim(), createdAt,
        };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },

    getVoidLogs(filters?: { fromDate?: string; toDate?: string; reason?: string; limit?: number }): VoidLogRecord[] {
      const where: string[] = ['action_type IS NOT NULL'];
      const args: (string | number)[] = [];
      if (filters?.fromDate) { where.push('created_at >= ?'); args.push(filters.fromDate); }
      if (filters?.toDate) { where.push('created_at <= ?'); args.push(filters.toDate); }
      if (filters?.reason) { where.push('reason = ?'); args.push(filters.reason); }
      const limit = filters?.limit ?? 100;
      if (!Number.isInteger(limit) || limit <= 0) throw new Error(`[db] void log limit must be > 0 (got ${limit})`);
      const rows = db.prepare(
        `SELECT id, action_type, product_id, product_name, amount_ct, cashier_name,
           manager_name, reason, session_id, created_at
         FROM void_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      ).all(...args, limit) as unknown as {
        id: number; action_type: ProtectedActionType; product_id: number | null; product_name: string | null;
        amount_ct: number; cashier_name: string; manager_name: string | null;
        reason: string; session_id: string | null; created_at: string;
      }[];
      return rows.map(r => ({
        actionType: r.action_type, productId: r.product_id ?? undefined,
        productName: r.product_name ?? undefined, amountCt: r.amount_ct,
        cashierName: r.cashier_name ?? '', managerApprovedBy: r.manager_name ?? undefined,
        reason: r.reason, sessionId: r.session_id ?? undefined,
        id: String(r.id), createdAt: r.created_at,
      }));
    },

    getVoidSummaryBySession(sessionId?: string): VoidSummary {
      const row = (sessionId === undefined
        ? db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_ct), 0) AS t FROM void_log WHERE action_type IS NOT NULL")
        : db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_ct), 0) AS t FROM void_log WHERE action_type IS NOT NULL AND session_id = ?')
      ).get(...(sessionId === undefined ? [] : [sessionId])) as { n: number; t: number };
      return { totalVoidCount: row.n, totalVoidAmountCt: row.t };
    },

    setManagerPin(newPin: string): void {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
        .run(MANAGER_PIN_META_KEY, createPinHash(newPin));
    },

    verifyManagerPinDb(inputPin: string): boolean {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(MANAGER_PIN_META_KEY) as
        | { value: string }
        | undefined;
      return verifyPin(inputPin, row?.value);
    },

    createDatabaseBackup(options?: { destinationDir?: string; label?: string; exempt?: boolean }): BackupMetadata {
      const dir = path.resolve(options?.destinationDir ?? 'data/backups');
      fs.mkdirSync(dir, { recursive: true });
      const now = new Date();
      // Backup-Pro: canonical name from the shared catalog (same in every lane).
      let n = 0;
      let filename = backupFilename(now, options?.label ?? '', 0);
      while (fs.existsSync(path.join(dir, filename))) {
        n += 1;
        filename = backupFilename(now, options?.label ?? '', n);
      }
      const label = (options?.label ?? '').replace(/[^A-Za-z0-9-_]/g, '').slice(0, 24);
      const filePath = path.join(dir, filename);
      // Hot snapshot: atomic, non-blocking under WAL (readers keep serving).
      db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
      const snap = new DatabaseSync(filePath);
      try {
        const check = snap.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (check.integrity_check !== 'ok') throw new Error(`[db] snapshot integrity_check failed: ${check.integrity_check}`);
        const sales = (snap.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;
        const products = (snap.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n;
        const schemaVersion = (snap.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        const sha256 = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
        const size = fs.statSync(filePath).size;
        const createdAt = new Date().toISOString();
        const id = randomUUID();
        const exempt = options?.exempt === true ? 1 : 0;
        db.prepare(
          `INSERT INTO backups_log (id, filename, file_path, file_size_bytes, sha256_checksum,
            sales_count, products_count, status, created_at, exempt)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`,
        ).run(id, filename, filePath, size, sha256, sales, products, createdAt, exempt);
        // Backup-Pro: manifest sidecar — the catalog survives even if the live
        // DB (and its backups_log) is lost. Verify + list read it back.
        const manifest: BackupManifest = buildManifest({
          app_version: APP_VERSION, schema_version: schemaVersion, label,
          created_at: createdAt, filename, sha256,
          size_bytes: size, sales_count: sales, products_count: products,
        });
        fs.writeFileSync(manifestPathFor(filePath), JSON.stringify(manifest, null, 2));
        const meta: BackupMetadata = {
          id, filename, filePath, fileSizeBytes: size, sha256Checksum: sha256,
          salesCount: sales, productsCount: products, status: 'VERIFIED', createdAt,
          label, appVersion: APP_VERSION, schemaVersion, exempt: exempt === 1,
        };
        // Backup-Pro: retention — keep the newest 30 NON-EXEMPT snapshots.
        // Pre-reset safety archives (exempt=1) never enter the prune plan.
        try {
          const rows = db.prepare(
            'SELECT id, filename, file_path AS filePath, created_at AS created_at, exempt FROM backups_log ORDER BY created_at DESC, rowid DESC',
          ).all() as { id: string; filename: string; filePath: string; created_at: string; exempt: number }[];
          const candidates = rows.filter(r => r.exempt !== 1);
          for (const old of prunePlan(candidates, BACKUP_RETENTION_KEEP)) {
            if (old.filePath) unlinkWithRetry(old.filePath);
            if (old.filePath) unlinkWithRetry(manifestPathFor(old.filePath));
            // Honest retention: only drop the log row when the bytes are
            // really gone. A surviving file keeps its row so the next backup
            // retries the sweep instead of orphaning it forever.
            if (old.filePath && fs.existsSync(old.filePath)) continue;
            db.prepare('DELETE FROM backups_log WHERE id = ?').run(old.id);
          }
        } catch (e) {
          console.warn(`[db] backup retention prune skipped: ${(e as Error).message}`);
        }
        return meta;
      } finally {
        snap.close();
      }
    },

    listDatabaseBackups(): BackupMetadata[] {
      const rows = db.prepare('SELECT * FROM backups_log ORDER BY created_at DESC, rowid DESC').all() as unknown as {
        id: string; filename: string; file_path: string; file_size_bytes: number;
        sha256_checksum: string; sales_count: number; products_count: number;
        status: string; created_at: string; exempt?: number;
      }[];
      const out: BackupMetadata[] = [];
      for (const r of rows) {
        if (!fs.existsSync(r.file_path)) continue;
        const actual = createHash('sha256').update(fs.readFileSync(r.file_path)).digest('hex');
        if (actual !== r.sha256_checksum) {
          db.prepare("UPDATE backups_log SET status = 'CORRUPT' WHERE id = ?").run(r.id);
          continue;
        }
        // Backup-Pro: sidecar enriches the row (label/app/schema); absent on
        // legacy snapshots — the row itself stays authoritative.
        let label = '';
        let appVersion = '';
        let schemaVersion = 0;
        try {
          const raw = fs.readFileSync(manifestPathFor(r.file_path), 'utf8');
          const m = JSON.parse(raw) as BackupManifest;
          if (checkManifestShape(m).length === 0 && m.sha256.toLowerCase() === actual.toLowerCase()) {
            label = m.label; appVersion = m.app_version; schemaVersion = m.schema_version;
          }
        } catch { /* legacy snapshot without sidecar */ }
        out.push({
          id: r.id, filename: r.filename, filePath: r.file_path, fileSizeBytes: r.file_size_bytes,
          sha256Checksum: r.sha256_checksum, salesCount: r.sales_count, productsCount: r.products_count,
          status: r.status as BackupMetadata['status'], createdAt: r.created_at,
          label, appVersion, schemaVersion, exempt: r.exempt === 1,
        });
      }
      return out;
    },

    searchProductTemplates(query: string, limit = 8): ProductTemplate[] {
      return searchCatalog(loadReferenceCatalog().templates, query, limit);
    },

    validateBackupForRestore(backupPath: string): BackupValidationReport {
      const errors: string[] = [];
      const resolved = path.resolve(backupPath);
      let size = 0;
      if (!fs.existsSync(resolved)) errors.push('file does not exist');
      else {
        size = fs.statSync(resolved).size;
        if (size === 0) errors.push('file is empty');
        else {
          const magic = fs.readFileSync(resolved).subarray(0, 16).toString('latin1');
          if (magic !== 'SQLite format 3\0') errors.push('bad SQLite header magic');
        }
      }
      let sha256 = '';
      let salesCount = 0;
      let tableCount = 0;
      let integrity = 'not-run';
      if (errors.length === 0) {
        sha256 = createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
        // Backup-Pro: when a manifest sidecar exists it must agree with the
        // bytes on disk — a swapped/renamed file fails closed here.
        try {
          const raw = fs.readFileSync(manifestPathFor(resolved), 'utf8');
          const m = JSON.parse(raw) as BackupManifest;
          const shapeErrors = checkManifestShape(m);
          if (shapeErrors.length > 0) errors.push(`manifest malformed: ${shapeErrors.join(', ')}`);
          else {
            if (m.sha256.toLowerCase() !== sha256.toLowerCase()) errors.push('manifest sha256 mismatch');
            if (m.size_bytes !== size) errors.push('manifest size mismatch');
            if (m.filename !== path.basename(resolved)) errors.push('manifest filename mismatch');
          }
        } catch {
          // No sidecar (legacy snapshot) — byte checks below still gate.
        }
        const snap = new DatabaseSync(resolved);
        try {
          const check = snap.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
          integrity = check.integrity_check;
          if (integrity !== 'ok') errors.push(`integrity_check: ${integrity}`);
          tableCount = (snap.prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          ).get() as { n: number }).n;
          if (tableCount === 0) errors.push('no user tables found');
          try {
            salesCount = (snap.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;
          } catch {
            errors.push('sales table unreadable');
          }
        } catch (e) {
          errors.push(`snapshot open failed: ${(e as Error).message}`);
        } finally {
          snap.close();
        }
      }
      return {
        isValid: errors.length === 0, sha256, fileSizeBytes: size, salesCount,
        tableCount, integrityCheckResult: integrity, errors,
      };
    },

    restoreBackupSafely(backupPath: string): RestoreResult {
      const report = (this as unknown as BarakaDb).validateBackupForRestore(backupPath);
      if (!report.isValid) {
        throw new Error(`[db] BACKUP_INTEGRITY_FAILED: ${report.errors.join('; ')}`);
      }
      if (dbPath === ':memory:') throw new Error('[db] cannot restore over a :memory: database');
      const qdir = path.resolve('data/quarantine');
      fs.mkdirSync(qdir, { recursive: true });
      const d = new Date();
      const p2 = (n: number): string => String(n).padStart(2, '0');
      const qfile = path.join(
        qdir, `pre-restore-quarantine-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.sqlite`,
      );
      db.exec(`VACUUM INTO '${qfile.replace(/'/g, "''")}'`);
      const qsnap = new DatabaseSync(qfile);
      try {
        const check = qsnap.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (check.integrity_check !== 'ok') throw new Error('[db] quarantine snapshot failed integrity_check');
      } finally {
        qsnap.close();
      }
      const target = path.resolve(backupPath);
      db.close();
      // Live handle is now closed; the caller MUST reopen (server re-provisions,
      // tests open a fresh handle) before issuing further queries.
      const livePath = path.resolve(dbPath);
      fs.copyFileSync(target, livePath);
      const mark = new DatabaseSync(livePath);
      try {
        // The snapshot predates its own log row, so the restore journals a
        // fresh RESTORED entry recomputed from the restored file.
        const sha = createHash('sha256').update(fs.readFileSync(livePath)).digest('hex');
        const size = fs.statSync(livePath).size;
        const sales = (mark.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;
        const products = (mark.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n;
        mark.prepare(
          `INSERT INTO backups_log (id, filename, file_path, file_size_bytes, sha256_checksum,
            sales_count, products_count, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'RESTORED', ?)`,
        ).run(randomUUID(), path.basename(target), target, size, sha, sales, products, new Date().toISOString());
      } finally {
        mark.close();
      }
      return {
        success: true, quarantineBackupPath: qfile,
        restoredBackupPath: path.resolve(dbPath), restoredAt: new Date().toISOString(),
      };
    },

    factoryReset(archiveRef: string, actor: string): { cleared: Record<string, number>; archive: string } {
      // P3 (v1.4.4): legal clean-start. The VERIFIED exempt pre-reset archive
      // must exist and match its bytes — the reset never runs without proof
      // the old chain is preserved. Append-only triggers are dropped and
      // rebuilt inside the same Immediate transaction (never left dropped).
      const row = db.prepare(
        `SELECT file_path AS fp, sha256_checksum AS sha, status, exempt FROM backups_log
         WHERE file_path = ? OR filename = ? ORDER BY created_at DESC LIMIT 1`,
      ).get(archiveRef, archiveRef) as
        | { fp: string; sha: string; status: string; exempt: number }
        | undefined;
      if (!row || row.exempt !== 1 || row.status !== 'VERIFIED') {
        throw new Error('[db] factory-reset refused: no VERIFIED exempt pre-reset archive');
      }
      if (!fs.existsSync(row.fp)) throw new Error('[db] factory-reset refused: archive file missing');
      const actual = createHash('sha256').update(fs.readFileSync(row.fp)).digest('hex');
      if (actual.toLowerCase() !== row.sha.toLowerCase()) {
        throw new Error('[db] factory-reset refused: archive checksum mismatch');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        const saved = db.prepare(
          `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN
           ('trg_sales_no_delete', 'trg_sale_items_no_delete', 'trg_settlements_no_delete', 'trg_audit_no_delete')`,
        ).all() as { name: string; sql: string }[];
        for (const t of saved) db.exec(`DROP TRIGGER IF EXISTS "${t.name.replace(/"/g, '""')}"`);
        const cleared: Record<string, number> = {};
        const tables = [
          // Children before parents (foreign_keys=ON aborts parent-first deletes).
          'sale_items', 'client_settlements', 'purchase_items', 'purchases',
          'supplier_payments', 'void_log', 'cash_movements', 'cash_sessions',
          'z_reports', 'inventory_losses', 'sales',
          'seq', 'active_cart_draft', 'audit_log',
        ];
        for (const table of tables) {
          const exists = db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
          ).get(table) as { name: string } | undefined;
          if (!exists) continue;
          const r = db.prepare(`DELETE FROM "${table.replace(/"/g, '""')}"`).run();
          cleared[table] = Number(r.changes ?? 0);
        }
        for (const t of saved) db.exec(t.sql);
        logAuditRow(db, {
          actor, action: 'factory_reset',
          detail: `clean start by ${actor}; pre-reset archive ${row.fp} sha ${row.sha.slice(0, 16)}…`,
        });
        db.exec('COMMIT');
        return { cleared, archive: row.fp };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already failed */ }
        throw e;
      }
    },

    nextInvoiceNumber(year: number): string {
      return `FACT-${year}-${pad6(bumpSeq(db, 'FACT', year))}`;
    },

    nextTicketNumber(year: number): string {
      return `T-${year}-${pad6(bumpSeq(db, 'T', year))}`;
    },

    recordSale(header: SaleHeaderInput, items: SaleItemInput[]) {
      if (items.length === 0) throw new Error('[db] cannot record a sale with zero items');
      // Fiscal regime travels with the commit; absent flags = legacy (both apply).
      const regime = {
        tva_enabled: header.fiscal_regime?.tva_enabled !== false,
        timbre_enabled: header.fiscal_regime?.timbre_enabled !== false,
      };
      const t = header.totals;
      for (const k of ['total_ht_ct', 'total_tva_ct', 'timbre_ct', 'total_ttc_ct'] as const) {
        assertIntegerCentimes(t[k], `totals.${k}`);
      }
      if (t.total_ht_ct + t.total_tva_ct + t.timbre_ct !== t.total_ttc_ct) {
        throw new Error('[db] header totals invariant broken: HT + TVA + timbre !== TTC');
      }
      let sumHt = 0, sumTva = 0, sumTtc = 0;
      const tier: Record<TVARate, { b: number; a: number; t: number }> = {
        0: { b: 0, a: 0, t: 0 }, 9: { b: 0, a: 0, t: 0 }, 19: { b: 0, a: 0, t: 0 },
      };
      for (const it of items) {
        assertTvaRate(it.tva_rate);
        for (const k of ['unit_price_ct', 'line_ht_ct', 'line_tva_ct', 'line_ttc_ct'] as const) {
          assertIntegerCentimes(it[k], `item.${k}`);
        }
        assertIntegerCentimes(it.qty_milli, 'item.qty_milli');
        if (it.qty_milli <= 0) throw new Error('[db] item qty_milli must be > 0');
        if (it.line_ht_ct + it.line_tva_ct !== it.line_ttc_ct) {
          throw new Error('[db] line invariant broken: HT + TVA !== TTC');
        }
        sumHt += it.line_ht_ct; sumTva += it.line_tva_ct; sumTtc += it.line_ttc_ct;
        const g = tier[it.tva_rate];
        g.b += it.line_ht_ct; g.a += it.line_tva_ct; g.t += it.line_ttc_ct;
      }
      if (sumHt !== t.total_ht_ct || sumTva !== t.total_tva_ct) {
        throw new Error('[db] item sums do not match header HT/TVA totals');
      }
      for (const r of [0, 9, 19] as TVARate[]) {
        const bd = t.tva_breakdown[r];
        if (bd.base_ht_ct !== tier[r].b || bd.tva_amount_ct !== tier[r].a || bd.total_ttc_ct !== tier[r].t) {
          throw new Error(`[db] item sums do not match header TVA ${r}% breakdown`);
        }
      }
      // Regime TVA off: the header must carry zero TVA (client coerced lines to tier 0).
      if (!regime.tva_enabled && t.total_tva_ct !== 0) {
        throw new Error('[db] regime TVA off but header carries TVA — refusing to record');
      }
      const expectedTimbre = calculateTimbreFiscalCt(sumTtc, header.payment_method, { ...timbreProfile(), ...regime });
      if (expectedTimbre !== t.timbre_ct) {
        throw new Error(`[db] timbre mismatch: engine says ${t.timbre_ct}ct, fiscal rule says ${expectedTimbre}ct`);
      }
      assertIntegerCentimes(header.amount_paid_ct, 'amount_paid_ct');
      assertIntegerCentimes(header.amount_returned_ct, 'amount_returned_ct');

      const createdAt = header.created_at ?? new Date().toISOString();
      const year = parseInt(createdAt.slice(0, 4), 10);
      const id = header.id ?? randomUUID();
      const clientSaleId = header.client_sale_id ?? null;
      // T1 (ADR-021): idempotent commit. A retried POST (double click, replay
      // after a dropped connection) returns the ORIGINAL row — seq, stock and
      // ledger are never consumed twice.
      const byKey = (k: string) => db.prepare(
        'SELECT id, invoice_number, ticket_number FROM sales WHERE client_sale_id = ?',
      ).get(k) as { id: string; invoice_number: string; ticket_number: string } | undefined;
      if (clientSaleId) {
        const existing = byKey(clientSaleId);
        if (existing) return { id: existing.id, invoice_number: existing.invoice_number, ticket_number: existing.ticket_number };
      }
      // #004: a legally closed day is frozen — no new posting may land in it.
      // (Idempotent replays return above, so retries of an already-recorded
      // sale never trip this guard.)
      const saleDay = createdAt.slice(0, 10);
      if (isDayLocked(db, saleDay)) {
        throw new Error(`[db] day ${saleDay} is already legally closed (Z FINALISÉ) — sale refused`);
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        const invoice = `FACT-${year}-${pad6(bumpSeq(db, 'FACT', year))}`;
        const ticket = `T-${year}-${pad6(bumpSeq(db, 'T', year))}`;
        db.prepare(
          `INSERT INTO sales (id, invoice_number, ticket_number, cashier_id, cashier_name, client_id,
            client_name, client_nif, client_nis, client_rc, client_ai, client_address,
            total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct,
            tva0_base_ct, tva0_amt_ct, tva0_ttc_ct, tva9_base_ct, tva9_amt_ct, tva9_ttc_ct,
            tva19_base_ct, tva19_amt_ct, tva19_ttc_ct,
            payment_method, tva_enabled, timbre_enabled, amount_paid_ct, amount_returned_ct, status, is_facture, created_at,
            client_sale_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
        ).run(
          id, invoice, ticket, header.cashier_id, header.cashier_name, header.client_id ?? null,
          header.client_name ?? null, header.client_nif ?? null, header.client_nis ?? null,
          header.client_rc ?? null, header.client_ai ?? null, header.client_address ?? null,
          t.total_ht_ct, t.total_tva_ct, t.timbre_ct, t.total_ttc_ct,
          t.tva_breakdown[0].base_ht_ct, t.tva_breakdown[0].tva_amount_ct, t.tva_breakdown[0].total_ttc_ct,
          t.tva_breakdown[9].base_ht_ct, t.tva_breakdown[9].tva_amount_ct, t.tva_breakdown[9].total_ttc_ct,
          t.tva_breakdown[19].base_ht_ct, t.tva_breakdown[19].tva_amount_ct, t.tva_breakdown[19].total_ttc_ct,
          header.payment_method, regime.tva_enabled ? 1 : 0, regime.timbre_enabled ? 1 : 0,
          header.amount_paid_ct, header.amount_returned_ct,
          header.is_facture ?? 0, createdAt, clientSaleId,
        );
        const insItem = db.prepare(
          `INSERT INTO sale_items (sale_id, product_id, barcode, name_fr, name_ar, unit_price_ct,
            qty_milli, unit, tva_rate, discount_bp, line_ht_ct, line_tva_ct, line_ttc_ct)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const decStock = db.prepare('UPDATE products SET stock_milli = stock_milli - ? WHERE id = ?');
        for (const it of items) {
          insItem.run(id, it.product_id, it.barcode, it.name_fr, it.name_ar, it.unit_price_ct,
            it.qty_milli, it.unit, it.tva_rate, it.discount_bp, it.line_ht_ct, it.line_tva_ct, it.line_ttc_ct);
          if (it.product_id !== null) decStock.run(it.qty_milli, it.product_id);
        }
        db.exec('COMMIT');
        return { id, invoice_number: invoice, ticket_number: ticket };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        // T1 race net: two checkouts with the same key racing each other —
        // the loser returns the winner's row instead of an error.
        if (clientSaleId && /UNIQUE constraint failed: sales\.client_sale_id|idx_sales_client_sale_id/.test((e as Error).message)) {
          const winner = byKey(clientSaleId);
          if (winner) return { id: winner.id, invoice_number: winner.invoice_number, ticket_number: winner.ticket_number };
        }
        throw e;
      }
    },

    getSale(id: string): Record<string, unknown> {
      const row = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`[db] sale not found: ${id}`);
      return row;
    },

    getSaleOrNull(id: string): Record<string, unknown> | null {
      const row = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ?? null;
    },

    activeSalesCount(): number {
      return (db.prepare("SELECT COUNT(*) AS c FROM sales WHERE status = 'COMPLETED'").get() as { c: number }).c;
    },

    voidSale(saleId: string, reason: string, voidedBy: string) {
      if (!reason.trim()) throw new Error('[db] void reason is required (legal journal)');
      db.exec('BEGIN IMMEDIATE');
      try {
        const sale = db.prepare('SELECT id, invoice_number, status, created_at FROM sales WHERE id = ?').get(saleId) as
          | { id: string; invoice_number: string; status: string; created_at: string } | undefined;
        if (!sale) throw new Error(`[db] sale not found: ${saleId}`);
        if (sale.status === 'CANCELLED') throw new Error('[db] sale already voided');
        // #004: a legally closed day is frozen — voids to it are refused.
        const day = sale.created_at.slice(0, 10);
        if (isDayLocked(db, day)) {
          throw new Error(`[db] day ${day} is already legally closed (Z FINALISÉ) — void refused`);
        }
        db.prepare("UPDATE sales SET status = 'CANCELLED' WHERE id = ?").run(saleId);
        db.prepare(
          'INSERT INTO void_log (sale_id, invoice_number, reason, voided_by, voided_at) VALUES (?, ?, ?, ?, ?)',
        ).run(saleId, sale.invoice_number, reason, voidedBy, new Date().toISOString());
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },

    backupTo(destPath: string) {
      if (!destPath.endsWith('.db')) throw new Error('[db] backup destination must end with .db');
      fs.mkdirSync(path.dirname(path.resolve(destPath)), { recursive: true });
      const escaped = path.resolve(destPath).replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escaped}'`);
    },

    saveCartDraft(sessionId: string, payloadJson: string, itemCount: number, totalTtcCt: number) {
      if (!sessionId.trim()) throw new Error('[db] sessionId is required for cart draft');
      assertIntegerCentimes(totalTtcCt, 'totalTtcCt');
      if (!Number.isInteger(itemCount) || itemCount < 0) throw new Error('[db] itemCount must be >= 0');
      JSON.parse(payloadJson); // fail fast on corrupt payloads
      db.prepare(
        `INSERT INTO active_cart_draft (session_id, payload_json, item_count, total_ttc_ct, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT (session_id) DO UPDATE SET payload_json = excluded.payload_json,
           item_count = excluded.item_count, total_ttc_ct = excluded.total_ttc_ct,
           updated_at = datetime('now')`,
      ).run(sessionId, payloadJson, itemCount, totalTtcCt);
    },

    loadCartDraft(sessionId: string) {
      const row = db.prepare(
        'SELECT payload_json, item_count, total_ttc_ct, updated_at FROM active_cart_draft WHERE session_id = ?',
      ).get(sessionId) as
        | { payload_json: string; item_count: number; total_ttc_ct: number; updated_at: string }
        | undefined;
      return row ?? null;
    },

    clearCartDraft(sessionId: string) {
      db.prepare('DELETE FROM active_cart_draft WHERE session_id = ?').run(sessionId);
    },

    recordSettlement(input: {
      id?: string; client_id: number; client_name?: string; amount_ct: number;
      payment_method: 'ESPECES' | 'CIB' | 'DAHABIYA' | 'CREDIT';
      timbre_ct?: number; total_collected_ct?: number; receipt_number?: string;
      date?: string; note?: string | null;
      /** Fiscal regime (owner toggle): absent = timbre applies (legacy callers). */
      timbre_enabled?: boolean;
      /** T2b (ADR-024): checkout-minted idempotency key, stable across retries. */
      client_settlement_key?: string | null;
    }) {
      assertIntegerCentimes(input.amount_ct, 'amount_ct');
      if (input.amount_ct <= 0) throw new Error('[db] settlement amount must be > 0');
      const timbreCt = input.timbre_ct ?? 0;
      const collectedCt = input.total_collected_ct ?? input.amount_ct;
      assertIntegerCentimes(timbreCt, 'timbre_ct');
      assertIntegerCentimes(collectedCt, 'total_collected_ct');
      // Fiscal cross-check: recompute timbre from the engine (client row may not exist in tests).
      const expected = calculateTimbreFiscalCt(input.amount_ct, input.payment_method, {
        ...timbreProfile(), timbre_enabled: input.timbre_enabled !== false,
      });
      if (expected !== timbreCt) {
        throw new Error(`[db] settlement timbre mismatch: got ${timbreCt}ct, fiscal rule says ${expected}ct`);
      }
      const id = input.id ?? randomUUID();
      const key = input.client_settlement_key ?? null;
      const byKey = (k: string) => db.prepare(
        'SELECT id, receipt_number FROM client_settlements WHERE client_settlement_key = ?',
      ).get(k) as { id: string; receipt_number: string } | undefined;
      // T2b idempotent path: retries return the ORIGINAL receipt, Q never re-consumed.
      if (key) {
        const existing = byKey(key);
        if (existing) return { id: existing.id, receipt_number: existing.receipt_number };
      }
      const year = parseInt((input.date ?? new Date().toISOString()).slice(0, 4), 10);
      db.exec('BEGIN IMMEDIATE');
      try {
        const client = db.prepare(
          'SELECT id, name, phone, credit_balance_ct, max_credit_limit_ct FROM clients WHERE id = ?',
        ).get(input.client_id) as
          | { id: number; name: string; phone: string; credit_balance_ct: number; max_credit_limit_ct: number }
          | undefined;
        if (!client) throw new Error(`[db] CLIENT_NOT_FOUND: ${input.client_id}`);
        // Art.136: cash (ESPECES) inflows >= 50 DZD carry stamp duty (already cross-checked above).
        const newBalance = client.credit_balance_ct - input.amount_ct;
        db.prepare('UPDATE clients SET credit_balance_ct = ? WHERE id = ?').run(newBalance, client.id);
        const receipt = input.receipt_number ?? `Q-${year}-${pad6(bumpSeq(db, 'Q', year))}`;
        db.prepare(
          `INSERT INTO client_settlements (id, client_id, client_name, amount_ct, payment_method,
            timbre_ct, total_collected_ct, receipt_number, date, note, client_settlement_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, input.client_id, input.client_name ?? '', input.amount_ct, input.payment_method,
          timbreCt, collectedCt, receipt, input.date ?? new Date().toISOString(), input.note ?? null, key,
        );
        db.exec('COMMIT');
        return { id, receipt_number: receipt };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        // T2b race net: the loser returns the winner's receipt.
        if (key && /UNIQUE constraint failed: client_settlements\.client_settlement_key|idx_settlements_client_key/.test((e as Error).message)) {
          const winner = byKey(key);
          if (winner) return { id: winner.id, receipt_number: winner.receipt_number };
        }
        throw e;
      }
    },
    getMeta(key: string): string | null {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },
    setMeta(key: string, value: string) {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
    },
    createUser(input: { username: string; display_name?: string; role: Role; pin: string }, actor: string): SafeUser {
      const username = input.username.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,20}$/.test(username)) throw new Error('[db] bad username (3-20 chars: a-z 0-9 . _ -)');
      if (!isRole(input.role)) throw new Error(`[db] bad role: ${input.role}`);
      if (!isValidP(input.pin)) throw new Error('[db] PIN must be 4-8 numeric digits');
      try {
        const r = db.prepare(
          'INSERT INTO users (username, display_name, role, pin_verifier, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(username, input.display_name ?? username, input.role, createPinHash(input.pin), new Date().toISOString());
        logAuditRow(db, { actor, action: 'user.create', entity: 'users', entityId: username, detail: `role=${input.role}` });
        return safeUser(userRow(db, Number(r.lastInsertRowid)));
      } catch (e) {
        if (String((e as Error)?.message ?? e).includes('UNIQUE')) throw new Error(`[db] username taken: ${username}`);
        throw e;
      }
    },
    verifyUser(username: string, pin: string): { ok: true; user: SafeUser } | { ok: false; locked: boolean } {
      const name = username.trim().toLowerCase();
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(name) as UserRow | undefined;
      const now = Date.now();
      if (!row || !row.active) {
        logAuditRow(db, { actor: name, action: 'login.fail', detail: 'unknown-or-inactive' });
        return { ok: false as const, locked: false };
      }
      if (row.locked_until_ms > now) {
        logAuditRow(db, { actor: name, action: 'login.locked' });
        return { ok: false as const, locked: true };
      }
      const ok = verifyPin(pin, row.pin_verifier);
      const next = registerAttempt(
        { failedAttempts: row.failed_attempts, lockedUntil: row.locked_until_ms || null, lockCycles: row.lock_cycles },
        ok, now,
      );
      db.prepare('UPDATE users SET failed_attempts = ?, locked_until_ms = ?, lock_cycles = ? WHERE id = ?')
        .run(next.failedAttempts, next.lockedUntil ?? 0, next.lockCycles, row.id);
      if (!ok) {
        logAuditRow(db, { actor: name, action: 'login.fail' });
        return { ok: false as const, locked: (next.lockedUntil ?? 0) > now };
      }
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
      logAuditRow(db, { actor: name, action: 'login.ok' });
      return { ok: true as const, user: safeUser(row) };
    },
    listUsers(): SafeUser[] {
      return (db.prepare('SELECT id, username, display_name, role, must_change_pin, active FROM users ORDER BY id').all() as unknown as SafeUser[]);
    },
    setUserActive(id: number, active: boolean, actor: string): void {
      const row = userRow(db, id); // throws when missing
      if (row.role === 'owner') throw new Error('[db] the owner account cannot be deactivated');
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
      logAuditRow(db, { actor, action: 'user.deactivate', entity: 'users', entityId: row.username, detail: active ? 'reactivated' : 'deactivated' });
    },
    changePin(userId: number, oldPin: string, newPin: string): void {
      const row = userRow(db, userId);
      if (!verifyPin(oldPin, row.pin_verifier)) {
        logAuditRow(db, { actor: row.username, action: 'login.fail', detail: 'pin-change denied' });
        throw new Error('[db] current PIN is wrong');
      }
      if (!isValidP(newPin)) throw new Error('[db] PIN must be 4-8 numeric digits');
      db.prepare('UPDATE users SET pin_verifier = ?, must_change_pin = 0 WHERE id = ?').run(createPinHash(newPin), userId);
      logAuditRow(db, { actor: row.username, action: 'pin.change' });
    },
    listAudit(limit = 100): AuditRow[] {
      const n = Math.max(1, Math.min(500, Math.floor(limit)));
      return db.prepare('SELECT id, ts, actor, action, entity, entity_id, detail FROM audit_log ORDER BY id DESC LIMIT ?').all(n) as unknown as AuditRow[];
    },
    logAudit(e: AuditEvent): void {
      logAuditRow(db, e);
    },
    getLatestZHash(): string {
      const row = db.prepare('SELECT hash FROM z_reports ORDER BY rowid DESC LIMIT 1').get() as { hash: string } | undefined;
      return row?.hash ?? GENESIS_Z_HASH;
    },
    finalizeZReport(input: {
      day: string; openingTime: string; closingTime: string;
      totals: {
        salesCount: number; totalHtCt: number; tva0BaseCt: number; tva9BaseCt: number;
        tva9AmtCt: number; tva19BaseCt: number; tva19AmtCt: number; totalTvaCt: number;
        totalTimbreCt: number; totalTtcCt: number; especesGrossCt: number; cibTotalCt: number;
        dahabiyaTotalCt: number; creditGrantedCt: number; creditCollectedCt: number;
        firstInvoice: string; lastInvoice: string;
      };
    }) {
      const t = input.totals;
      for (const [k, v] of Object.entries(t)) {
        if (typeof v === 'number' && !Number.isInteger(v)) throw new Error(`[db] z_report ${k} must be integer centimes`);
      }
      const year = parseInt(input.day.slice(0, 4), 10);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('[db] z_report invalid day');
      // #004: one legal DAY close per day — a second finalize is refused
      // (the Z seq is never consumed twice for the same day).
      if (isDayLocked(db, input.day)) {
        throw new Error(`[db] day ${input.day} is already legally closed (Z FINALISÉ) — close refused`);
      }
      // #004: the caller's totals must reproduce the SQLite ledger exactly.
      // The UI merges CIB+DAHABIYA into one lane, so the bank split compares
      // combined; every other field compares one-to-one.
      const ledger = computeDayAggregates(db, input.day);
      const bad: string[] = [];
      const num = (label: string, got: number, want: number) => {
        if (got !== want) bad.push(`${label}: caller=${got} ledger=${want}`);
      };
      num('salesCount', t.salesCount, ledger.salesCount);
      num('totalHtCt', t.totalHtCt, ledger.totalHtCt);
      num('tva0BaseCt', t.tva0BaseCt, ledger.tva0BaseCt);
      num('tva9BaseCt', t.tva9BaseCt, ledger.tva9BaseCt);
      num('tva9AmtCt', t.tva9AmtCt, ledger.tva9AmtCt);
      num('tva19BaseCt', t.tva19BaseCt, ledger.tva19BaseCt);
      num('tva19AmtCt', t.tva19AmtCt, ledger.tva19AmtCt);
      num('totalTvaCt', t.totalTvaCt, ledger.totalTvaCt);
      num('totalTimbreCt', t.totalTimbreCt, ledger.totalTimbreCt);
      num('totalTtcCt', t.totalTtcCt, ledger.totalTtcCt);
      num('especesGrossCt', t.especesGrossCt, ledger.especesGrossCt);
      num('bankSplitCt', t.cibTotalCt + t.dahabiyaTotalCt, ledger.cibTotalCt + ledger.dahabiyaTotalCt);
      num('creditGrantedCt', t.creditGrantedCt, ledger.creditGrantedCt);
      num('creditCollectedCt', t.creditCollectedCt, ledger.creditCollectedCt);
      if (t.firstInvoice !== ledger.firstInvoice) bad.push(`firstInvoice: caller=${t.firstInvoice} ledger=${ledger.firstInvoice}`);
      if (t.lastInvoice !== ledger.lastInvoice) bad.push(`lastInvoice: caller=${t.lastInvoice} ledger=${ledger.lastInvoice}`);
      if (bad.length > 0) {
        throw new Error(`[db] z_report totals do not match SQLite ledger for ${input.day}: ${bad.join('; ')}`);
      }
      const prev = ((): string => {
        const row = db.prepare('SELECT hash FROM z_reports ORDER BY rowid DESC LIMIT 1').get() as { hash: string } | undefined;
        return row?.hash ?? GENESIS_Z_HASH;
      })();
      const number = `Z-${year}-${pad6(bumpSeq(db, 'Z', year))}`;
      const hash = computeZHashDb(prev, number, input.day, t.totalTtcCt, t.totalTimbreCt);
      db.prepare(
        `INSERT INTO z_reports (report_number, day, opening_time, closing_time,
          total_sales_count, total_ht_ct, tva0_base_ct, tva9_base_ct, tva9_amt_ct,
          tva19_base_ct, tva19_amt_ct, total_tva_ct, total_timbre_ct, total_ttc_ct,
          especes_gross_ct, cib_total_ct, dahabiya_total_ct, credit_granted_ct,
          credit_collected_ct, first_invoice_number, last_invoice_number,
          prev_hash, hash, finalized, close_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'DAY')`,
      ).run(
        number, input.day, input.openingTime, input.closingTime,
        t.salesCount, t.totalHtCt, t.tva0BaseCt, t.tva9BaseCt, t.tva9AmtCt,
        t.tva19BaseCt, t.tva19AmtCt, t.totalTvaCt, t.totalTimbreCt, t.totalTtcCt,
        t.especesGrossCt, t.cibTotalCt, t.dahabiyaTotalCt, t.creditGrantedCt,
        t.creditCollectedCt, t.firstInvoice, t.lastInvoice, prev, hash,
      );
      return { report_number: number, hash, prev_hash: prev };
    },
    listZReports(): Record<string, unknown>[] {
      return db.prepare('SELECT * FROM z_reports ORDER BY rowid ASC').all() as Record<string, unknown>[];
    },
  };
}
