/**
 * ADR-053 P3 — pinned catalog lane tests (TS): v17 migration, NULL barcodes,
 * control #1, POIDS Q4 rule, pin CRUD, track_stock sale/return neutrality.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openBarakaDb } from './sqlite.js';
import type { ProductRow } from './sqlite.js';
import { calculateLineTotalsCt, calculateSaleTotalsCt } from '../core/fiscal.centimes.js';
import type { SaleItemInput } from './sqlite.js';

const NOON = '2026-11-25T10:00:00.000Z';

function prod(over: Partial<ProductRow> & { id: number }): ProductRow {
  return {
    barcode: '613000000001', name_fr: 'X', name_ar: '', category_id: 'c',
    buy_price_ct: 0, sell_price_ct: 10000, tva_rate: 19, stock_milli: 0,
    min_stock_milli: 0, unit: 'PIECE', is_scale: 0, scale_item_code: null,
    has_expiry: 0, expiry_date: null, ...over,
  } as ProductRow;
}

function catItem(pid: number, priceCt: number, qty = 1): SaleItemInput {
  const line = calculateLineTotalsCt(priceCt, qty, 0);
  return {
    product_id: pid, barcode: `BC-${pid}`, name_fr: `P${pid}`, name_ar: '',
    unit_price_ct: priceCt, qty_milli: 1000 * qty, unit: 'PIECE', tva_rate: 0,
    discount_bp: 0, line_ht_ct: line.total_line_ht_ct,
    line_tva_ct: line.total_line_tva_ct, line_ttc_ct: line.total_line_ttc_ct,
  };
}

function sell(b: ReturnType<typeof openBarakaDb>, id: string, items: SaleItemInput[]) {
  const t = calculateSaleTotalsCt(items.map(i => ({ tva_rate: i.tva_rate, total_line_ht_ct: i.line_ht_ct, total_line_tva_ct: i.line_tva_ct, total_line_ttc_ct: i.line_ttc_ct })), 'ESPECES');
  return b.recordSale({
    id, cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
    amount_paid_ct: t.total_ttc_ct, amount_returned_ct: 0, totals: t, created_at: NOON,
  }, items);
}

/** Fabricate a genuine v16 file: old products shape + legacy '' barcode. */
function makeV16File(): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p3-')), 'v16.db');
  const raw = new DatabaseSync(f);
  raw.exec(`CREATE TABLE products (
    id INTEGER PRIMARY KEY, barcode TEXT NOT NULL UNIQUE, name_fr TEXT NOT NULL,
    name_ar TEXT NOT NULL DEFAULT '', category_id TEXT NOT NULL DEFAULT '',
    buy_price_ct INTEGER NOT NULL, sell_price_ct INTEGER NOT NULL, tva_rate INTEGER NOT NULL,
    stock_milli INTEGER NOT NULL DEFAULT 0, min_stock_milli INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL, is_scale INTEGER NOT NULL DEFAULT 0, scale_item_code TEXT,
    has_expiry INTEGER NOT NULL DEFAULT 0, expiry_date TEXT)`);
  raw.exec(`INSERT INTO products (id, barcode, name_fr, buy_price_ct, sell_price_ct, tva_rate, stock_milli, unit)
    VALUES (1, '', 'LEGACY-EMPTY', 0, 5000, 19, 7000, 'PIECE'),
           (2, '613000000002', 'LEGACY-REAL', 0, 9000, 19, 3000, 'PIECE')`);
  raw.exec('PRAGMA user_version = 16');
  raw.close();
  return f;
}

test('db ADR-053 P3: v16 file climbs to v17, legacy empty barcode becomes NULL', () => {
  const f = makeV16File();
  const b = openBarakaDb(f);
  try {
    const v = (b.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    assert.equal(v, 17);
    const cols = b.db.prepare('PRAGMA table_info(products)').all() as { name: string }[];
    for (const c of ['kind', 'price_per_kg_ct', 'tare_g', 'pin_order', 'track_stock', 'pinned_until']) {
      assert.ok(cols.some(x => x.name === c), `column ${c}`);
    }
    const rows = b.db.prepare('SELECT id, barcode FROM products ORDER BY id').all() as { id: number; barcode: string | null }[];
    assert.equal(rows[0].barcode, null);
    assert.equal(rows[1].barcode, '613000000002');
    // Legacy rows carried stock truth → stay tracked (ADR-047 preserved).
    const tr = b.db.prepare('SELECT COUNT(*) AS n FROM products WHERE track_stock = 1').get() as { n: number };
    assert.equal(tr.n, 2);
  } finally { b.close(); }
});

test('db ADR-053 P3: multiple NULL barcodes coexist; raw empty string rejected', () => {
  const b = openBarakaDb(':memory:');
  try {
    b.upsertProduct(prod({ id: 11, barcode: null, name_fr: 'OEUF' }));
    b.upsertProduct(prod({ id: 12, barcode: null, name_fr: 'FROMAGE' }));
    b.upsertProduct(prod({ id: 13, barcode: '', name_fr: 'VIDE-NORM' })); // normalized
    assert.equal(b.getProduct(13).barcode, null);
    assert.throws(
      () => b.db.exec(`INSERT INTO products (id, barcode, name_fr, buy_price_ct, sell_price_ct, tva_rate, stock_milli, unit) VALUES (99, '', 'RAW', 0, 1, 0, 0, 'PIECE')`),
      /CHECK/,
    );
  } finally { b.close(); }
});

test('db ADR-053 P3: POIDS requires owner-set price/kg (Q4)', () => {
  const b = openBarakaDb(':memory:');
  try {
    assert.throws(() => b.upsertProduct(prod({ id: 21, barcode: null, name_fr: 'LENTILLES', kind: 'POIDS' })), /price_per_kg_ct/);
    assert.throws(() => b.upsertProduct(prod({ id: 21, barcode: null, name_fr: 'LENTILLES', kind: 'POIDS', price_per_kg_ct: 0 })), /price_per_kg_ct/);
    assert.throws(() => b.upsertProduct(prod({ id: 21, barcode: null, name_fr: 'X', kind: 'WEIRD' as never })), /kind/);
    b.upsertProduct(prod({ id: 21, barcode: null, name_fr: 'LENTILLES', kind: 'POIDS', price_per_kg_ct: 28000, tare_g: 15 }));
    const r = b.getProduct(21);
    assert.equal(r.kind, 'POIDS');
    assert.equal(r.price_per_kg_ct, 28000);
  } finally { b.close(); }
});

test('db ADR-053 P3: pin CRUD — order, evict, expiry, validation', () => {
  const b = openBarakaDb(':memory:');
  try {
    b.upsertProduct(prod({ id: 31, barcode: null, name_fr: 'OEUF' }));
    b.upsertProduct(prod({ id: 32, barcode: null, name_fr: 'BONBON' }));
    b.upsertProduct(prod({ id: 33, barcode: null, name_fr: 'SAISON', pinned_until: '2020-01-01' }));
    b.setProductPin(31, { pin_order: 1 });
    b.setProductPin(32, { pin_order: 2, pin_color: 'amber', pin_icon: 'candy' });
    b.setProductPin(33, { pin_order: 3 }); // expired → hidden from tiles
    let pins = b.getPinnedProducts('2026-11-25');
    assert.deepEqual(pins.map(p => p.id), [31, 32]);
    // Evict: slot 2 moves to 31.
    b.setProductPin(31, { pin_order: 2 });
    pins = b.getPinnedProducts('2026-11-25');
    assert.deepEqual(pins.map(p => p.id), [31]);
    assert.equal(b.getProduct(32).pin_order, null);
    // Unpin + validation.
    b.setProductPin(31, { pin_order: null });
    assert.deepEqual(b.getPinnedProducts('2026-11-25').map(p => p.id), []);
    assert.throws(() => b.setProductPin(31, { pin_order: 0 }), /pin_order/);
    assert.throws(() => b.setProductPin(31, { pin_order: 13 }), /pin_order/);
    assert.throws(() => b.setProductPin(9999, { pin_order: 1 }), /not found/);
    // POIDS price guard also applies at pin time.
    assert.throws(() => b.setProductPin(31, { pin_order: 1, kind: 'POIDS', price_per_kg_ct: null }), /price_per_kg/);
    b.setProductPin(31, { pin_order: 1, kind: 'POIDS', price_per_kg_ct: 28000, track_stock: 0 });
    assert.equal(b.getProduct(31).price_per_kg_ct, 28000);
  } finally { b.close(); }
});

test('db ADR-053 P3: untracked article sells without stock move or negative flag', () => {
  const b = openBarakaDb(':memory:');
  try {
    b.upsertProduct(prod({ id: 41, barcode: null, name_fr: 'OEUF', stock_milli: 0, track_stock: 0 }));
    b.upsertProduct(prod({ id: 42, barcode: '613000000042', name_fr: 'LAIT', stock_milli: 1000, track_stock: 1 }));
    const out = sell(b, 'p3-u1', [catItem(41, 30000), catItem(42, 18000, 2)]);
    const sale = b.getSale(out.id) as unknown as { was_negative: number };
    assert.equal(sale.was_negative, 1); // tracked LAIT short (2u vs 1u) still flags
    assert.equal((b.db.prepare('SELECT stock_milli FROM products WHERE id = 41').get() as { stock_milli: number }).stock_milli, 0);
    assert.equal((b.db.prepare('SELECT stock_milli FROM products WHERE id = 42').get() as { stock_milli: number }).stock_milli, -1000);
    // Pure untracked basket: no flag at all.
    const out2 = sell(b, 'p3-u2', [catItem(41, 30000)]);
    assert.equal((b.getSale(out2.id) as unknown as { was_negative: number }).was_negative, 0);
  } finally { b.close(); }
});

test('db ADR-053 P3: pinned articles are returnable — RESTOCK neutral for untracked, live for tracked', () => {
  const b = openBarakaDb(':memory:');
  try {
    b.upsertProduct(prod({ id: 51, barcode: null, name_fr: 'BONBON', stock_milli: 0, track_stock: 0, pin_order: 4 }));
    b.upsertProduct(prod({ id: 52, barcode: '613000000052', name_fr: 'LAIT', stock_milli: 2000, track_stock: 1, pin_order: 5 }));
    b.openCashSession('Amine', 1000000);
    const s = sell(b, 'p3-r1', [catItem(51, 10000), catItem(52, 18000, 2)]);
    const [lUntracked, lTracked] = (b.db.prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC').all(s.id) as { id: number }[]).map(r => r.id);
    const d = b.createReturnDraft({
      sale_id: s.id,
      lines: [{ saleItemId: lUntracked, qty_milli: 1000 }, { saleItemId: lTracked, qty_milli: 2000 }],
      reason: 'DEFECT', actor: 'lina',
    });
    // Force RESTOCK on both lines (DEFECT defaults to QUARANTINE): return-item
    // ids follow creation order — resolve them from the draft head instead.
    const head = b.getReturnOrNull(d.id) as unknown as { items: { id: number }[] };
    const disp: Record<number, 'RESTOCK'> = {};
    for (const it of head.items) disp[it.id] = 'RESTOCK';
    b.approveReturn(d.id, 'karim', 'manager', disp);
    // Untracked pinned article: no phantom stock from the return.
    assert.equal((b.db.prepare('SELECT stock_milli FROM products WHERE id = 51').get() as { stock_milli: number }).stock_milli, 0);
    // Tracked pinned article: full round-trip (2000 out, 2000 back).
    assert.equal((b.db.prepare('SELECT stock_milli FROM products WHERE id = 52').get() as { stock_milli: number }).stock_milli, 2000);
  } finally { b.close(); }
});
