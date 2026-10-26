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
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIntegerCentimes } from '../core/money.js';
import { calculateTimbreFiscalCt, type SaleTotalsCt } from '../core/fiscal.centimes.js';
import { GENESIS_PREV_HASH as GENESIS_Z_HASH, computeZHash as computeZHashDb } from '../core/zreport.js';
import type { PaymentMethod, TVARate } from '../types';

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

function schemaSql(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
}

export interface BarakaDb {
  db: DatabaseSync;
  close(): void;
  pragmas(): { journal_mode: string; foreign_keys: number };
  upsertProduct(p: ProductRow): void;
  getProduct(id: number): ProductRow;
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

export function openBarakaDb(dbPath: string): BarakaDb {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(schemaSql());
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

    nextInvoiceNumber(year: number): string {
      return `FACT-${year}-${pad6(bumpSeq(db, 'FACT', year))}`;
    },

    nextTicketNumber(year: number): string {
      return `T-${year}-${pad6(bumpSeq(db, 'T', year))}`;
    },

    recordSale(header: SaleHeaderInput, items: SaleItemInput[]) {
      if (items.length === 0) throw new Error('[db] cannot record a sale with zero items');
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
      const expectedTimbre = calculateTimbreFiscalCt(sumTtc, header.payment_method, timbreProfile());
      if (expectedTimbre !== t.timbre_ct) {
        throw new Error(`[db] timbre mismatch: engine says ${t.timbre_ct}ct, fiscal rule says ${expectedTimbre}ct`);
      }
      assertIntegerCentimes(header.amount_paid_ct, 'amount_paid_ct');
      assertIntegerCentimes(header.amount_returned_ct, 'amount_returned_ct');

      const createdAt = header.created_at ?? new Date().toISOString();
      const year = parseInt(createdAt.slice(0, 4), 10);
      const id = header.id ?? randomUUID();

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
            payment_method, amount_paid_ct, amount_returned_ct, status, is_facture, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)`,
        ).run(
          id, invoice, ticket, header.cashier_id, header.cashier_name, header.client_id ?? null,
          header.client_name ?? null, header.client_nif ?? null, header.client_nis ?? null,
          header.client_rc ?? null, header.client_ai ?? null, header.client_address ?? null,
          t.total_ht_ct, t.total_tva_ct, t.timbre_ct, t.total_ttc_ct,
          t.tva_breakdown[0].base_ht_ct, t.tva_breakdown[0].tva_amount_ct, t.tva_breakdown[0].total_ttc_ct,
          t.tva_breakdown[9].base_ht_ct, t.tva_breakdown[9].tva_amount_ct, t.tva_breakdown[9].total_ttc_ct,
          t.tva_breakdown[19].base_ht_ct, t.tva_breakdown[19].tva_amount_ct, t.tva_breakdown[19].total_ttc_ct,
          header.payment_method, header.amount_paid_ct, header.amount_returned_ct,
          header.is_facture ?? 0, createdAt,
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
        const sale = db.prepare('SELECT id, invoice_number, status FROM sales WHERE id = ?').get(saleId) as
          | { id: string; invoice_number: string; status: string } | undefined;
        if (!sale) throw new Error(`[db] sale not found: ${saleId}`);
        if (sale.status === 'CANCELLED') throw new Error('[db] sale already voided');
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
    }) {
      assertIntegerCentimes(input.amount_ct, 'amount_ct');
      if (input.amount_ct <= 0) throw new Error('[db] settlement amount must be > 0');
      const timbreCt = input.timbre_ct ?? 0;
      const collectedCt = input.total_collected_ct ?? input.amount_ct;
      assertIntegerCentimes(timbreCt, 'timbre_ct');
      assertIntegerCentimes(collectedCt, 'total_collected_ct');
      // Fiscal cross-check: recompute timbre from the engine (client row may not exist in tests).
      const expected = calculateTimbreFiscalCt(input.amount_ct, input.payment_method, timbreProfile());
      if (expected !== timbreCt) {
        throw new Error(`[db] settlement timbre mismatch: got ${timbreCt}ct, fiscal rule says ${expected}ct`);
      }
      const id = input.id ?? randomUUID();
      const year = parseInt((input.date ?? new Date().toISOString()).slice(0, 4), 10);
      const receipt = input.receipt_number ?? `Q-${year}-${pad6(bumpSeq(db, 'Q', year))}`;
      db.prepare(
        `INSERT INTO client_settlements (id, client_id, client_name, amount_ct, payment_method,
          timbre_ct, total_collected_ct, receipt_number, date, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, input.client_id, input.client_name ?? '', input.amount_ct, input.payment_method,
        timbreCt, collectedCt, receipt, input.date ?? new Date().toISOString(), input.note ?? null,
      );
      return { id, receipt_number: receipt };
    },
    getMeta(key: string): string | null {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },
    setMeta(key: string, value: string) {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
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
          prev_hash, hash, finalized)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
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
