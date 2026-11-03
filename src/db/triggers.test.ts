import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb, LATEST_SCHEMA_VERSION } from './sqlite.js';
import { calculateSaleTotalsCt } from '../core/fiscal.centimes.js';

// T11 slice A (ADR-034): append-only + terminal-state triggers. Raw SQL must
// fail where the application lane already refuses: deletes on fiscal tables,
// updates on audit_log, resurrection of CANCELLED sales.
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
  id: 1, barcode: '6130000000014', name_fr: 'LAIT', name_ar: 'حليب',
  category_id: 'laiterie', buy_price_ct: 14500, sell_price_ct: 18000,
  tva_rate: 9 as const, stock_milli: 48000, min_stock_milli: 10000,
  unit: 'PIECE' as const, is_scale: 0, scale_item_code: null,
  has_expiry: 1, expiry_date: '2026-12-15',
};
const LINES = [
  { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE' as const, tva_rate: 9 as const, discount_bp: 0, line_ht_ct: 33028, line_tva_ct: 2972, line_ttc_ct: 36000 },
];
const header = () => ({
  cashier_id: 'C-1', cashier_name: 'Amine',
  payment_method: 'ESPECES' as const, amount_paid_ct: 40000, amount_returned_ct: 4000,
  totals: calculateSaleTotalsCt(
    [{ tva_rate: 9 as const, total_line_ht_ct: 33028, total_line_tva_ct: 2972, total_line_ttc_ct: 36000 }],
    'ESPECES',
  ),
  created_at: '2026-10-26T14:00:00.000Z',
});

test('t11: fiscal tables + audit are append-only, CANCELLED is terminal', () => {
  const b = openBarakaDb(':memory:');
  b.upsertProduct(PROD);
  const s = b.recordSale(header(), LINES);
  b.voidSale(s.id, 't11-test', 'owner');
  const boom = (sql: string, msg: string) =>
    assert.throws(() => b.db.exec(sql), /append-only|terminal/, msg);
  boom(`DELETE FROM sales WHERE id = '${s.id}'`, 'sales delete aborts');
  boom('DELETE FROM sale_items', 'sale_items delete aborts');
  boom("UPDATE sales SET status = 'COMPLETED' WHERE status = 'CANCELLED'", 'resurrection aborts');
  boom('DELETE FROM users', 'users delete aborts');
  boom('DELETE FROM audit_log', 'audit delete aborts');
  boom("UPDATE audit_log SET detail = 'x'", 'audit update aborts');
  // The legal path still works: COMPLETED -> CANCELLED via voidSale.
  const s2 = b.recordSale(header(), LINES);
  b.voidSale(s2.id, 't11-legal', 'owner');
  assert.equal((b.db.prepare("SELECT status AS s FROM sales WHERE id = ?").get(s2.id) as { s: string }).s, 'CANCELLED');
  b.close();
});

test('t11: settlement rows are append-only', () => {
  const b = openBarakaDb(':memory:');
  b.db.prepare(`INSERT INTO clients (id, name, credit_balance_ct, max_credit_limit_ct)
    VALUES (1, 'Zed', 500000, 0)`).run();
  b.recordSettlement({
    client_id: 1, amount_ct: 100000, payment_method: 'ESPECES',
    timbre_ct: 1000, total_collected_ct: 101000, date: '2026-11-01T12:00:00.000Z',
  });
  assert.throws(() => b.db.exec('DELETE FROM client_settlements'), /append-only/);
  b.close();
});

test('t11: v4 file climbs to v7 with triggers intact', () => {
  const p = tmpFile('t11v4');
  try {
    const b = openBarakaDb(p);
    assert.equal(LATEST_SCHEMA_VERSION, 7);
    // Simulate a v4 file: drop the v5 triggers, reset the version stamp.
    for (const t of ['trg_sales_no_delete', 'trg_sale_items_no_delete', 'trg_settlements_no_delete',
      'trg_sales_terminal', 'trg_users_no_delete', 'trg_audit_no_delete', 'trg_audit_no_update']) {
      b.db.exec(`DROP TRIGGER IF EXISTS ${t}`);
    }
    b.db.exec('PRAGMA user_version = 4');
    b.close();
    // Reopen climbs: version + all seven triggers back.
    const c = openBarakaDb(p);
    assert.equal((c.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 7);
    const names = (c.db.prepare("SELECT name AS n FROM sqlite_master WHERE type = 'trigger'").all() as { n: string }[]).map(r => r.n);
    for (const t of ['trg_sales_no_delete', 'trg_sales_terminal', 'trg_audit_no_update']) {
      assert.ok(names.includes(t), `trigger ${t} restored`);
    }
    assert.throws(() => c.db.exec('DELETE FROM users'), /append-only/);
    c.close();
  } finally {
    cleanup(p);
  }
});
