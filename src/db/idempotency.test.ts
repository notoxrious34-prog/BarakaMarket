import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb, LATEST_SCHEMA_VERSION } from './sqlite.js';
import { calculateLineTotalsCt, calculateSaleTotalsCt } from '../core/fiscal.centimes.js';

// T1 slice A (ADR-021) + T3 foundation: idempotent sale commit + versioned migration.
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

const LINES = [
  { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE' as const, tva_rate: 9 as const, discount_bp: 0, line_ht_ct: 33028, line_tva_ct: 2972, line_ttc_ct: 36000 },
  { product_id: 1, barcode: 'b', name_fr: 'HUILE', name_ar: '', unit_price_ct: 65000, qty_milli: 1000, unit: 'PIECE' as const, tva_rate: 0 as const, discount_bp: 0, line_ht_ct: 65000, line_tva_ct: 0, line_ttc_ct: 65000 },
  { product_id: 1, barcode: 'c', name_fr: 'CHOC', name_ar: '', unit_price_ct: 12000, qty_milli: 3000, unit: 'PIECE' as const, tva_rate: 19 as const, discount_bp: 0, line_ht_ct: 30252, line_tva_ct: 5748, line_ttc_ct: 36000 },
  { product_id: 1, barcode: 'd', name_fr: 'POMMES', name_ar: '', unit_price_ct: 28000, qty_milli: 1450, unit: 'KG' as const, tva_rate: 9 as const, discount_bp: 0, line_ht_ct: 37248, line_tva_ct: 3352, line_ttc_ct: 40600 },
];

function totals() {
  const items = [
    { tva_rate: 9 as const, total_line_ht_ct: 33028, total_line_tva_ct: 2972, total_line_ttc_ct: 36000 },
    { tva_rate: 0 as const, total_line_ht_ct: 65000, total_line_tva_ct: 0, total_line_ttc_ct: 65000 },
    { tva_rate: 19 as const, total_line_ht_ct: 30252, total_line_tva_ct: 5748, total_line_ttc_ct: 36000 },
    { tva_rate: 9 as const, total_line_ht_ct: 37248, total_line_tva_ct: 3352, total_line_ttc_ct: 40600 },
  ];
  return calculateSaleTotalsCt(items, 'ESPECES');
}

const header = (extra: Record<string, unknown> = {}) => ({
  cashier_id: 'C-1', cashier_name: 'Amine',
  payment_method: 'ESPECES' as const, amount_paid_ct: 200000, amount_returned_ct: 20600,
  totals: totals(), created_at: '2026-10-26T14:00:00.000Z', ...extra,
});

const seqLast = (b: ReturnType<typeof openBarakaDb>, kind: string) =>
  (b.db.prepare('SELECT last_n AS n FROM seq WHERE kind = ? AND year = 2026').get(kind) as { n: number }).n;

test('t1: retried commit with same key returns ORIGINAL row, consumes seq once', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  const first = b.recordSale(header({ client_sale_id: 'KEY-1' }), LINES);
  const retry = b.recordSale(header({ client_sale_id: 'KEY-1' }), LINES);
  assert.equal(retry.id, first.id);
  assert.equal(retry.invoice_number, first.invoice_number);
  assert.equal(retry.ticket_number, first.ticket_number);
  assert.equal(b.activeSalesCount(), 1);
  assert.equal(seqLast(b, 'FACT'), 1);
  assert.equal(seqLast(b, 'T'), 1);
  // stock drained exactly once: 48.000 - 7.450 = 40.550
  assert.equal(b.getProduct(1).stock_milli, 40550);
  b.close();
});

test('t1: different keys consume strictly sequential numbers', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  const a = b.recordSale(header({ client_sale_id: 'KEY-A' }), LINES);
  const c = b.recordSale(header({ client_sale_id: 'KEY-C' }), LINES);
  assert.match(a.invoice_number, /^FACT-2026-000001$/);
  assert.match(c.invoice_number, /^FACT-2026-000002$/);
  assert.equal(b.activeSalesCount(), 2);
  b.close();
});

test('t1: legacy rows without a key still commit (null-key path)', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  const s = b.recordSale(header(), LINES);
  assert.match(s.invoice_number, /^FACT-2026-000001$/);
  b.close();
});

test('t3: v1 file migrates to v2 preserving rows, then dedupes', () => {
  const p = tmpFile('migv1');
  try {
    const b = openBarakaDb(p);
    assert.equal((b.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, LATEST_SCHEMA_VERSION);
    b.upsertProduct(PROD);
    const legacy = b.recordSale(header(), LINES);
    // simulate a v1 file: drop the T1 column + index, reset version
    b.db.exec('DROP INDEX IF EXISTS idx_sales_client_sale_id');
    b.db.exec('ALTER TABLE sales DROP COLUMN client_sale_id');
    b.db.exec('PRAGMA user_version = 0');
    b.close();
    // reopen climbs to v2 with the legacy row intact
    const c = openBarakaDb(p);
    assert.equal((c.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, LATEST_SCHEMA_VERSION);
    const cols = c.db.prepare('PRAGMA table_info(sales)').all() as { name: string }[];
    assert.ok(cols.some(x => x.name === 'client_sale_id'));
    assert.equal((c.getSale(legacy.id) as { total_ttc_ct: number }).total_ttc_ct, 179400);
    // post-migration: keyed commit + retry dedupe
    c.upsertProduct(PROD);
    const d1 = c.recordSale(header({ client_sale_id: 'POSTMIG' }), LINES);
    const d2 = c.recordSale(header({ client_sale_id: 'POSTMIG' }), LINES);
    assert.equal(d2.id, d1.id);
    assert.equal(c.activeSalesCount(), 2);
    c.close();
  } finally { cleanup(p); }
});

// ---- T2b (ADR-024): settlement lane idempotency (Q single-lane) ----
const seedClient = (b: ReturnType<typeof openBarakaDb>) => {
  b.db.prepare(`INSERT INTO clients (id, name, credit_balance_ct, max_credit_limit_ct)
    VALUES (1, 'Zed', 500000, 0)`).run();
};

const settle = (extra: Record<string, unknown> = {}) => ({
  client_id: 1, amount_ct: 100000, payment_method: 'ESPECES' as const,
  timbre_ct: 1000, total_collected_ct: 101000, date: '2026-11-01T12:00:00.000Z', ...extra,
});

test('t2b: retried settlement with same key returns ORIGINAL receipt, Q x1', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b);
  const s1 = b.recordSettlement(settle({ client_settlement_key: 'ST-1' }));
  const s2 = b.recordSettlement(settle({ client_settlement_key: 'ST-1' }));
  assert.equal(s2.id, s1.id);
  assert.equal(s2.receipt_number, s1.receipt_number);
  assert.match(s1.receipt_number, /^Q-2026-000001$/);
  const n = (b.db.prepare("SELECT COUNT(*) AS n FROM client_settlements").get() as { n: number }).n;
  assert.equal(n, 1);
  b.close();
});

test('t2b: distinct keys consume sequential Q numbers', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b);
  const a = b.recordSettlement(settle({ client_settlement_key: 'ST-A' }));
  const c = b.recordSettlement(settle({ client_settlement_key: 'ST-C' }));
  assert.match(a.receipt_number, /^Q-2026-000001$/);
  assert.match(c.receipt_number, /^Q-2026-000002$/);
  b.close();
});

test('t2b: v2 file climbs to v3 preserving settlements, then dedupes', () => {
  const p = tmpFile('migv2');
  try {
    const b = openBarakaDb(p);
    seedClient(b);
    const legacy = b.recordSettlement(settle());
    b.db.exec('DROP INDEX IF EXISTS idx_settlements_client_key');
    b.db.exec('ALTER TABLE client_settlements DROP COLUMN client_settlement_key');
    b.db.exec('PRAGMA user_version = 0');
    b.close();
    const c = openBarakaDb(p);
    assert.equal((c.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, LATEST_SCHEMA_VERSION);
    const cols = c.db.prepare('PRAGMA table_info(client_settlements)').all() as { name: string }[];
    assert.ok(cols.some(x => x.name === 'client_settlement_key'));
    assert.equal((c.db.prepare('SELECT total_collected_ct AS t FROM client_settlements WHERE id = ?').get(legacy.id) as { t: number }).t, 101000);
    const d1 = c.recordSettlement(settle({ client_settlement_key: 'POSTMIG-S' }));
    const d2 = c.recordSettlement(settle({ client_settlement_key: 'POSTMIG-S' }));
    assert.equal(d2.id, d1.id);
    c.close();
  } finally { cleanup(p); }
});
