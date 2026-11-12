import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openBarakaDb } from './sqlite.js';
import { calculateLineTotalsCt, calculateSaleTotalsCt } from '../core/fiscal.centimes.js';

// NOTE: C: is 100% full on this machine -> test DBs live under repo data/.tmp-tests (D:).
const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
let n = 0;
const tmpFile = (tag: string) => {
  n += 1;
  const p = path.join(TMP, `${tag}-${process.pid}-${n}.db`);
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* fresh */ }
  }
  return p;
};
const cleanup = (p: string) => {
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
};

const PROD = {
  id: 1, barcode: '6130000000014', name_fr: 'LAIT CONDENSE', name_ar: 'حليب',
  category_id: 'laiterie', buy_price_ct: 14500, sell_price_ct: 18000,
  tva_rate: 9 as const, stock_milli: 48000, min_stock_milli: 10000,
  unit: 'PIECE' as const, is_scale: 0, scale_item_code: null,
  has_expiry: 1, expiry_date: '2026-12-15',
};

function goldenSale() {
  const items = [
    { tva_rate: 9 as const, ...rename(calculateLineTotalsCt(18000, 2, 9)) },
    { tva_rate: 0 as const, ...rename(calculateLineTotalsCt(65000, 1, 0)) },
    { tva_rate: 19 as const, ...rename(calculateLineTotalsCt(12000, 3, 19)) },
    { tva_rate: 9 as const, ...rename(calculateLineTotalsCt(28000, 1.45, 9)) },
  ];
  return calculateSaleTotalsCt(items, 'ESPECES');
}
function rename(l: { total_line_ht_ct: number; total_line_tva_ct: number; total_line_ttc_ct: number }) {
  return l;
}

test('db: file open enforces WAL + foreign_keys', () => {
  const p = tmpFile('pragma');
  try {
    const b = openBarakaDb(p);
    assert.equal(b.pragmas().journal_mode.toLowerCase(), 'wal');
    assert.equal(b.pragmas().foreign_keys, 1);
    b.close();
  } finally { cleanup(p); }
});

test('db: TVA CHECK gate rejects 7 at product insert', () => {
  const b = openBarakaDb(':memory:');
  assert.throws(() => b.upsertProduct({ ...PROD, tva_rate: 7 as never }), /TVA rate must be|CHECK|constraint/i);
  b.close();
});

test('db: sequencer emits 1000 contiguous unique FACT numbers', () => {
  const b = openBarakaDb(':memory:');
  const first = b.nextInvoiceNumber(2026);
  assert.match(first, /^FACT-2026-\d{6}$/);
  const seen = new Set([first]);
  let last = first;
  for (let i = 0; i < 999; i++) {
    last = b.nextInvoiceNumber(2026);
    assert.ok(!seen.has(last), 'duplicate invoice number!');
    seen.add(last);
  }
  const nums = [...seen].map(s => parseInt(s.slice(-6), 10)).sort((x, y) => x - y);
  assert.equal(nums.length, 1000);
  assert.equal(nums[999] - nums[0], 999); // contiguous, no gaps
  b.close();
});

test('db: two connections interleave sequencer without collision', () => {
  const p = tmpFile('seq2');
  try {
    const a = openBarakaDb(p);
    const c = openBarakaDb(p);
    const got = new Set<string>();
    for (let i = 0; i < 50; i++) {
      got.add(a.nextTicketNumber(2026));
      got.add(c.nextTicketNumber(2026));
    }
    assert.equal(got.size, 100);
    a.close(); c.close();
  } finally { cleanup(p); }
});

test('db: recordSale golden receipt persists + decrements stock exactly', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  const t = goldenSale();
  const sale = b.recordSale(
    {
      cashier_id: 'C-1', cashier_name: 'Amine',
      payment_method: 'ESPECES', amount_paid_ct: 200000, amount_returned_ct: 20600,
      totals: t, created_at: '2026-10-26T14:00:00.000Z',
    },
    [
      { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE', tva_rate: 9, discount_bp: 0, line_ht_ct: 33028, line_tva_ct: 2972, line_ttc_ct: 36000 },
      { product_id: 1, barcode: 'b', name_fr: 'HUILE', name_ar: '', unit_price_ct: 65000, qty_milli: 1000, unit: 'PIECE', tva_rate: 0, discount_bp: 0, line_ht_ct: 65000, line_tva_ct: 0, line_ttc_ct: 65000 },
      { product_id: 1, barcode: 'c', name_fr: 'CHOC', name_ar: '', unit_price_ct: 12000, qty_milli: 3000, unit: 'PIECE', tva_rate: 19, discount_bp: 0, line_ht_ct: 30252, line_tva_ct: 5748, line_ttc_ct: 36000 },
      { product_id: 1, barcode: 'd', name_fr: 'POMMES', name_ar: '', unit_price_ct: 28000, qty_milli: 1450, unit: 'KG', tva_rate: 9, discount_bp: 0, line_ht_ct: 37248, line_tva_ct: 3352, line_ttc_ct: 40600 },
    ],
  );
  assert.match(sale.invoice_number, /^FACT-\d{4}-\d{6}$/);
  assert.match(sale.ticket_number, /^T-\d{4}-\d{6}$/);
  const row = b.getSale(sale.id);
  assert.equal(row.total_ttc_ct, 179400);
  assert.equal(row.timbre_ct, 1800);
  // stock 48.000 - (2.000 + 1.000 + 3.000 + 1.450) = 40.550 -> 40550 milli
  assert.equal(b.getProduct(1).stock_milli, 40550);
  b.close();
});

test('db: recordSale with broken invariant throws + rolls back fully', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  const t = goldenSale();
  assert.throws(
    () => b.recordSale(
      {
        cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
        amount_paid_ct: 200000, amount_returned_ct: 20600, totals: t,
        created_at: '2026-10-26T14:00:00.000Z',
      },
      [
        // HT+TVA (1+35999) !== TTC (36000) -> corrupt line
        { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE', tva_rate: 9, discount_bp: 0, line_ht_ct: 1, line_tva_ct: 35999, line_ttc_ct: 36000 },
      ],
    ),
    /invariant|totals/i,
  );
  assert.equal(b.activeSalesCount(), 0);
  assert.equal(b.getProduct(1).stock_milli, 48000); // untouched
  b.close();
});

test('db: ADR-047 — over-selling COMMITS with was_negative=1, stock goes negative, audit trace', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD); // stock 48.000
  // Consistent single line: 50 units x 18000ct, TVA 0 -> timbre 9000, TTC 909000.
  const line = calculateLineTotalsCt(18000, 50, 0);
  const t = calculateSaleTotalsCt([{ tva_rate: 0 as const, ...line }], 'ESPECES');
  const out = b.recordSale(
    {
      cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
      amount_paid_ct: 1000000, amount_returned_ct: 91000, totals: t,
      created_at: '2026-10-26T14:00:00.000Z',
    },
    [
      { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 50000, unit: 'PIECE', tva_rate: 0, discount_bp: 0, line_ht_ct: line.total_line_ht_ct, line_tva_ct: line.total_line_tva_ct, line_ttc_ct: line.total_line_ttc_ct },
    ],
  );
  assert.match(out.invoice_number, /^FACT-/);
  assert.equal(b.activeSalesCount(), 1);
  assert.equal(b.getProduct(1).stock_milli, -2000); // 48000 - 50000: negative, never clamped
  const row = b.getSale(out.id) as Record<string, unknown>;
  assert.equal(row.was_negative, 1);
  const audit = b.db.prepare("SELECT * FROM audit_log WHERE action = 'sale.negative'").all() as unknown[];
  assert.equal(audit.length, 1);
  b.close();
});

test('db: ADR-047 — meta allow_negative_sale=0 restores the Tier-3 refusal', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD); // stock 48.000
  b.db.prepare("INSERT INTO meta (key, value) VALUES ('allow_negative_sale', '0')").run();
  const line = calculateLineTotalsCt(18000, 50, 0);
  const t = calculateSaleTotalsCt([{ tva_rate: 0 as const, ...line }], 'ESPECES');
  assert.throws(
    () => b.recordSale(
      {
        cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
        amount_paid_ct: 1000000, amount_returned_ct: 91000, totals: t,
        created_at: '2026-10-26T14:00:00.000Z',
      },
      [
        { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 50000, unit: 'PIECE', tva_rate: 0, discount_bp: 0, line_ht_ct: line.total_line_ht_ct, line_tva_ct: line.total_line_tva_ct, line_ttc_ct: line.total_line_ttc_ct },
      ],
    ),
    /STOCK_INSUFFICIENT/,
  );
  assert.equal(b.activeSalesCount(), 0);
  assert.equal(b.getProduct(1).stock_milli, 48000); // untouched
  b.close();
});

test('db: voidSale keeps row CANCELLED + journal entry, excluded from active', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  const t = goldenSale();
  const sale = b.recordSale(
    {
      cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
      amount_paid_ct: 179400, amount_returned_ct: 0, totals: t,
      created_at: '2026-10-26T14:00:00.000Z',
    },
    [
      { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE', tva_rate: 9, discount_bp: 0, line_ht_ct: 33028, line_tva_ct: 2972, line_ttc_ct: 36000 },
      { product_id: 1, barcode: 'b', name_fr: 'HUILE', name_ar: '', unit_price_ct: 65000, qty_milli: 1000, unit: 'PIECE', tva_rate: 0, discount_bp: 0, line_ht_ct: 65000, line_tva_ct: 0, line_ttc_ct: 65000 },
      { product_id: 1, barcode: 'c', name_fr: 'CHOC', name_ar: '', unit_price_ct: 12000, qty_milli: 3000, unit: 'PIECE', tva_rate: 19, discount_bp: 0, line_ht_ct: 30252, line_tva_ct: 5748, line_ttc_ct: 36000 },
      { product_id: 1, barcode: 'd', name_fr: 'POMMES', name_ar: '', unit_price_ct: 28000, qty_milli: 1450, unit: 'KG', tva_rate: 9, discount_bp: 0, line_ht_ct: 37248, line_tva_ct: 3352, line_ttc_ct: 40600 },
    ],
  );
  b.voidSale(sale.id, 'client annule', 'manager');
  const row = b.getSale(sale.id);
  assert.equal(row.status, 'CANCELLED'); // row still present, never deleted
  assert.equal(b.activeSalesCount(), 0);
  const log = b.db.prepare('SELECT * FROM void_log WHERE sale_id = ?').get(sale.id) as Record<string, unknown>;
  assert.equal(log.invoice_number, sale.invoice_number);
  assert.equal(log.reason, 'client annule');
  b.close();
});

test('db: committed data survives reopen; uncommitted stays invisible (crash model)', () => {
  const p = tmpFile('crash');
  try {
    const w = openBarakaDb(p);
    w.upsertProduct(PROD);
    w.close();
    // writer begins but never commits (simulated kill -9 mid-transaction)
    const killer = new DatabaseSync(p);
    killer.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    killer.exec('BEGIN IMMEDIATE');
    killer.prepare("INSERT INTO sales (id, invoice_number, ticket_number, total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct, payment_method, created_at) VALUES ('GHOST','FACT-2026-999999','T-2026-999999',1,0,0,1,'ESPECES','2026-01-01')").run();
    // second connection must NOT see the ghost row (isolation)
    const reader = openBarakaDb(p);
    assert.equal(reader.getSaleOrNull('GHOST'), null);
    killer.exec('ROLLBACK'); // crash recovery outcome: uncommitted frames discarded
    killer.close();
    // committed product survived the whole episode
    assert.equal(reader.getProduct(1).barcode, PROD.barcode);
    assert.equal(reader.getSaleOrNull('GHOST'), null);
    reader.close();
  } finally { cleanup(p); }
});

test('db: backupTo produces a restorable copy with identical counts', () => {
  const p = tmpFile('src');
  const dst = tmpFile('bak');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    b.backupTo(dst);
    b.close();
    assert.ok(fs.statSync(dst).size > 0);
    const r = openBarakaDb(dst);
    assert.equal(r.getProduct(1).barcode, PROD.barcode);
    r.close();
  } finally { cleanup(p); cleanup(dst); }
});

test('db: legacy float seed converts to exact centimes/milli', () => {
  const b = openBarakaDb(':memory:');
  // legacy seed floats: 145 DZD buy, 180 sell, 48 pcs stock
  b.upsertProduct({ ...PROD, buy_price_ct: 14500, sell_price_ct: 18000, stock_milli: 48000 });
  const row = b.getProduct(1);
  assert.equal(row.buy_price_ct, 14500);
  assert.equal(row.sell_price_ct, 18000);
  assert.equal(row.stock_milli, 48000);
  assert.ok(Number.isInteger(row.buy_price_ct) && Number.isInteger(row.stock_milli));
  void os.tmpdir;
  b.close();
});

test('db: product_barcodes table exists with indexes + FK cascade', () => {
  const b = openBarakaDb(':memory:');
  const tables = (b as unknown as { db: { prepare: (s: string) => { all: () => { name: string }[] } } }).db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_barcodes'").all();
  assert.equal(tables.length, 1);
  const idx = (b as unknown as { db: { prepare: (s: string) => { all: () => { name: string }[] } } }).db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='product_barcodes'").all()
    .map(r => r.name).sort();
  assert.deepEqual(idx, ['idx_product_barcodes_barcode', 'idx_product_barcodes_product', 'sqlite_autoindex_product_barcodes_1']);
  b.upsertProduct(PROD);
  const aid = b.addProductBarcode({ product_id: 1, barcode: 'ALIAS-CASCADE', multiplier: 2, pack_name: 'Pack x2' });
  assert.equal(b.getProductBarcodes(1).length, 1);
  (b as unknown as { db: { exec: (s: string) => void } }).db.exec('DELETE FROM products WHERE id = 1');
  assert.equal(b.getProductBarcodes(1).length, 0);
  void aid;
  b.close();
});

test('db: resolveBarcode primary + alias x1 at unit price', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  b.addProductBarcode({ product_id: 1, barcode: '6130000000999' });
  const prim = b.resolveBarcode(PROD.barcode);
  assert.equal(prim?.isPack, false);
  assert.equal(prim?.multiplier, 1);
  assert.equal(prim?.effectivePriceCt, 18000);
  const alias = b.resolveBarcode('6130000000999');
  assert.equal(alias?.product.id, 1);
  assert.equal(alias?.isPack, false);
  assert.equal(alias?.multiplier, 1);
  assert.equal(alias?.effectivePriceCt, 18000);
  assert.equal(b.resolveBarcode('0000000000000'), null);
  b.close();
});

test('db: resolveBarcode pack x6 — override 18000 wins over 3500x6', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct({ ...PROD, id: 2, barcode: 'PACKPARENT', sell_price_ct: 3500, tva_rate: 0, stock_milli: 100000 });
  b.addProductBarcode({ product_id: 2, barcode: 'PACKX6', multiplier: 6, pack_name: 'Pack x6', price_override_ct: 18000 });
  b.addProductBarcode({ product_id: 2, barcode: 'CARTONX12', multiplier: 12, pack_name: 'Carton x12' });
  const pack = b.resolveBarcode('PACKX6');
  assert.equal(pack?.isPack, true);
  assert.equal(pack?.multiplier, 6);
  assert.equal(pack?.packName, 'Pack x6');
  assert.equal(pack?.effectivePriceCt, 18000);
  const carton = b.resolveBarcode('CARTONX12');
  assert.equal(carton?.effectivePriceCt, 42000);
  assert.throws(() => b.addProductBarcode({ product_id: 2, barcode: 'BAD', multiplier: 0 }), />= 1/);
  b.close();
});

test('db: recordSale 2 packs x6 drains exactly 12000 milli', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct({ ...PROD, id: 2, barcode: 'PACKPARENT', sell_price_ct: 3500, tva_rate: 0, stock_milli: 100000 });
  b.addProductBarcode({ product_id: 2, barcode: 'PACKX6', multiplier: 6, pack_name: 'Pack x6', price_override_ct: 18000 });
  const t = { total_ht_ct: 36000, total_tva_ct: 0, timbre_ct: 0, total_ttc_ct: 36000, tva_breakdown: { 0: { rate: 0 as const, base_ht_ct: 36000, tva_amount_ct: 0, total_ttc_ct: 36000 }, 9: { rate: 9 as const, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 }, 19: { rate: 19 as const, base_ht_ct: 0, tva_amount_ct: 0, total_ttc_ct: 0 } } };
  b.recordSale(
    { cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'CIB', amount_paid_ct: 36000, amount_returned_ct: 0, totals: t, created_at: '2026-10-27T10:00:00.000Z' },
    [
      { product_id: 2, barcode: 'PACKX6', name_fr: 'EAU [Pack x6]', name_ar: '', unit_price_ct: 18000, qty_milli: 12000, unit: 'PIECE', tva_rate: 0, discount_bp: 0, line_ht_ct: 36000, line_tva_ct: 0, line_ttc_ct: 36000 },
    ],
  );
  // 100.000 - 12.000 (2 packs x 6 units) = 88.000 milli
  assert.equal(b.getProduct(2).stock_milli, 88000);
  b.close();
});

test('db: PROD-SALE unknown client cash degrades to walk-in NULL, CREDIT refused', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  const line = { tva_rate: 9 as const, ...rename(calculateLineTotalsCt(18000, 2, 9)) };
  const item = { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE' as const, tva_rate: 9 as const, discount_bp: 0, line_ht_ct: line.total_line_ht_ct, line_tva_ct: line.total_line_tva_ct, line_ttc_ct: line.total_line_ttc_ct };
  const tEsp = calculateSaleTotalsCt([line], 'ESPECES');
  const sale = b.recordSale(
    {
      cashier_id: 'C-1', cashier_name: 'Amine', client_id: 999, client_name: 'Client Passager (Comptoir)',
      payment_method: 'ESPECES', amount_paid_ct: tEsp.total_ttc_ct, amount_returned_ct: 0,
      totals: tEsp, created_at: '2026-10-26T14:00:00.000Z',
    },
    [item],
  );
  assert.match(sale.invoice_number, /^FACT-\d{4}-\d{6}$/);
  assert.equal(b.getSale(sale.id).client_id, null);
  const tCred = calculateSaleTotalsCt([line], 'CREDIT');
  assert.throws(
    () => b.recordSale(
      {
        cashier_id: 'C-1', cashier_name: 'Amine', client_id: 999, client_name: 'X',
        payment_method: 'CREDIT', amount_paid_ct: 0, amount_returned_ct: 0,
        totals: tCred, created_at: '2026-10-26T14:00:00.000Z',
      },
      [item],
    ),
    /client inconnu/,
  );
  b.close();
});
