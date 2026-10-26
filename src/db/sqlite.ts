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
}

function bumpSeq(db: DatabaseSync, kind: 'FACT' | 'T', year: number): number {
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
  };
}
