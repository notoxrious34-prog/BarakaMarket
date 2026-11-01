import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from '../src/db/sqlite.js';
import { calculateSaleTotalsCt } from '../src/core/fiscal.centimes.js';

/**
 * T11 soak (ADR-034): sustained-load proof on a FILE-backed WAL database.
 * 500 sales + 200 settlements + 50 voids, then:
 *  - FACT/T/Q sequences strictly gapless (voids keep their numbers — tombstones, not holes)
 *  - centime-exact totals (sold - voided == active sum)
 *  - append-only triggers still armed after the load
 *  - throughput + WAL file sizes reported
 * The 8h shop-floor soak (real cashier, real cadence) remains a T12 exit step;
 * this is the accelerated mechanical equivalent.
 * Usage: npm run soak [N_SALES=500]
 */
const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
const DB = path.join(TMP, `soak-${process.pid}.db`);
for (const suf of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB + suf); } catch { /* fresh */ }
}

const N = Math.max(10, parseInt(process.argv[2] ?? '500', 10) || 500);
const db = openBarakaDb(DB);
db.upsertProduct({
  id: 1, barcode: '6130000000014', name_fr: 'LAIT', name_ar: 'حليب',
  category_id: 'laiterie', buy_price_ct: 14500, sell_price_ct: 18000,
  tva_rate: 9, stock_milli: 1_000_000_000, min_stock_milli: 0,
  unit: 'PIECE', is_scale: 0, scale_item_code: null, has_expiry: 0, expiry_date: null,
});
db.db.prepare(`INSERT INTO clients (id, name, credit_balance_ct, max_credit_limit_ct)
  VALUES (1, 'Soak', 100000000, 0)`).run();

const item = {
  product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000,
  qty_milli: 2000, unit: 'PIECE' as const, tva_rate: 9 as const, discount_bp: 0,
  line_ht_ct: 33028, line_tva_ct: 2972, line_ttc_ct: 36000,
};
const totals = calculateSaleTotalsCt(
  [{ tva_rate: 9 as const, total_line_ht_ct: 33028, total_line_tva_ct: 2972, total_line_ttc_ct: 36000 }],
  'ESPECES',
);
const header = (i: number) => ({
  cashier_id: 'U-1', cashier_name: 'Soak', payment_method: 'ESPECES' as const,
  amount_paid_ct: 40000, amount_returned_ct: 4000, totals,
  created_at: '2026-11-01T12:00:00.000Z', client_sale_id: `SOAK-${i}`,
});

const t0 = Date.now();
const ids: string[] = [];
for (let i = 0; i < N; i++) ids.push(db.recordSale(header(i), [item]).id);
const saleMs = Date.now() - t0;
for (let i = 0; i < 200; i++) {
  db.recordSettlement({
    client_id: 1, amount_ct: 100000, payment_method: 'ESPECES', timbre_ct: 1000,
    total_collected_ct: 101000, date: '2026-11-01T12:00:00.000Z',
    client_settlement_key: `SOAK-ST-${i}`,
  });
}
// Void every 10th sale (tombstones — numbers stay consumed).
for (let i = 0; i < ids.length; i += 10) db.voidSale(ids[i], 'soak', 'Soak');

// --- assertions ---
const facts = (db.db.prepare('SELECT invoice_number AS n FROM sales ORDER BY rowid').all() as { n: string }[]).map(r => r.n);
assert.equal(facts.length, N);
facts.forEach((f, i) => assert.match(f, new RegExp(`^FACT-2026-${String(i + 1).padStart(6, '0')}$`), `gapless FACT #${i + 1}`));
const qs = (db.db.prepare('SELECT receipt_number AS n FROM client_settlements ORDER BY rowid').all() as { n: string }[]).map(r => r.n);
assert.equal(qs.length, 200);
qs.forEach((q, i) => assert.match(q, new RegExp(`^Q-2026-${String(i + 1).padStart(6, '0')}$`), `gapless Q #${i + 1}`));
// Centime-exact: active sum == (N - voided) x per-sale TTC (timbre included).
const active = (db.db.prepare("SELECT COALESCE(SUM(total_ttc_ct),0) AS s FROM sales WHERE status <> 'CANCELLED'").get() as { s: number }).s;
assert.equal(active, (N - N / 10) * totals.total_ttc_ct, 'active total exact to the centime');
// Triggers still armed after the load.
assert.throws(() => db.db.exec('DELETE FROM sales'), /append-only/);
assert.throws(() => db.db.exec("UPDATE sales SET status='COMPLETED' WHERE status='CANCELLED'"), /terminal/);

const wal = fs.statSync(DB + '-wal').size;
const main = fs.statSync(DB).size;
console.log(`soak: ${N} sales + 200 settlements + ${N / 10} voids OK`);
console.log(`soak: gapless FACT x${N}, Q x200, active=${active}ct exact`);
console.log(`soak: ${(saleMs / N).toFixed(3)}ms/sale, db=${main}B wal=${wal}B`);
db.close();
for (const suf of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB + suf); } catch { /* clean */ }
}
