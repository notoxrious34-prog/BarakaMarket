import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from './index.js';
import { dzdToCentimes } from '../src/core/money.js';
import { calculateLineTotalsCt, calculateSaleTotalsCt } from '../src/core/fiscal.centimes.js';

const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
const DB = path.join(TMP, `api-${process.pid}.db`);
for (const suf of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB + suf); } catch { /* fresh */ }
}

const { app, baraka } = createApp(DB);
baraka.upsertProduct({
  id: 1, barcode: '6130000000014', name_fr: 'LAIT', name_ar: '', category_id: 'laiterie',
  buy_price_ct: 14500, sell_price_ct: 18000, tva_rate: 9, stock_milli: 48000,
  min_stock_milli: 10000, unit: 'PIECE', is_scale: 0, scale_item_code: null, has_expiry: 0, expiry_date: null,
});
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => new Promise<void>((r, e) => { server.close((err) => err ? e(err) : r()); baraka.close(); }));

const items = [
  { product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE', tva_rate: 9, discount_bp: 0, line_ht_ct: 33028, line_tva_ct: 2972, line_ttc_ct: 36000 },
  { product_id: 1, barcode: 'b', name_fr: 'HUILE', name_ar: '', unit_price_ct: 65000, qty_milli: 1000, unit: 'PIECE', tva_rate: 0, discount_bp: 0, line_ht_ct: 65000, line_tva_ct: 0, line_ttc_ct: 65000 },
  { product_id: 1, barcode: 'c', name_fr: 'CHOC', name_ar: '', unit_price_ct: 12000, qty_milli: 3000, unit: 'PIECE', tva_rate: 19, discount_bp: 0, line_ht_ct: 30252, line_tva_ct: 5748, line_ttc_ct: 36000 },
  { product_id: 1, barcode: 'd', name_fr: 'POMMES', name_ar: '', unit_price_ct: 28000, qty_milli: 1450, unit: 'KG', tva_rate: 9, discount_bp: 0, line_ht_ct: 37248, line_tva_ct: 3352, line_ttc_ct: 40600 },
];
const totals = calculateSaleTotalsCt(
  items.map(it => ({ tva_rate: it.tva_rate as 0 | 9 | 19, total_line_ht_ct: it.line_ht_ct, total_line_tva_ct: it.line_tva_ct, total_line_ttc_ct: it.line_ttc_ct })),
  'ESPECES',
);
const header = {
  cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
  amount_paid_ct: 200000, amount_returned_ct: 20600,
  totals: { ...totals, tva_breakdown: totals.tva_breakdown },
  created_at: '2026-10-26T15:00:00.000Z',
};
void dzdToCentimes;
void calculateLineTotalsCt;

test('api: health reports WAL', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  const j = await r.json() as Record<string, unknown>;
  assert.equal(j.ok, true);
  assert.equal(String(j.journal_mode).toLowerCase(), 'wal');
});

test('api: POST /sales records golden receipt with atomic numbers', async () => {
  const r = await fetch(`${base}/api/sales`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ header, items }),
  });
  assert.equal(r.status, 201);
  const j = await r.json() as Record<string, string>;
  assert.match(j.invoice_number, /^FACT-2026-\d{6}$/);
  const g = await (await fetch(`${base}/api/sales/${j.id}`)).json() as Record<string, number>;
  assert.equal(g.total_ttc_ct, 179400);
  assert.equal(g.timbre_ct, 1800);
});

test('api: corrupt sale rejected with 400, count unchanged', async () => {
  const bad = { ...items[0], line_ht_ct: 1, line_tva_ct: 35999 };
  const r = await fetch(`${base}/api/sales`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ header, items: [bad] }),
  });
  assert.equal(r.status, 400);
  const c = await (await fetch(`${base}/api/sales/active-count`)).json() as { active: number };
  assert.equal(c.active, 1);
});

test('api: void keeps row, z summary aggregates the day', async () => {
  const c0 = await (await fetch(`${base}/api/sales/active-count`)).json() as { active: number };
  assert.equal(c0.active, 1);
  const z = await (await fetch(`${base}/api/z/summary?date=2026-10-26`)).json() as Record<string, number>;
  assert.equal(z.sales_count, 1);
  assert.equal(z.total_ttc_ct, 179400);
  assert.equal(z.total_especes_ct, 179400);
});

test('api: raw-print spools drawer-kick bytes and rejects garbage', async () => {
  const ok = await fetch(`${base}/api/raw-print`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hex: '1b700019fa', label: 'drawer-kick' }),
  });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { bytes: number }).bytes, 5);
  const bad = await fetch(`${base}/api/raw-print`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hex: 'ZZZ' }),
  });
  assert.equal(bad.status, 400);
});

test('api: POST /purchases/receive commits BL with stock influx', async () => {
  (baraka as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
    .prepare('INSERT OR IGNORE INTO suppliers (id, name) VALUES (9, ?)').run('SUP API');
  const r = await fetch(`${base}/api/purchases/receive`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      supplierId: 9, invoiceRef: 'BL-API-1',
      items: [{ productId: 1, packMultiplier: 6, packCount: 2, unitCostCt: 14500 }],
      paidAmountCt: 0,
    }),
  });
  assert.equal(r.status, 201);
  const j = await r.json() as { success: boolean; totalCostCt: number; remainingDebtCt: number; itemsProcessed: number };
  assert.equal(j.success, true);
  // 12 units x 14500 HT = 174000; TVA 9% = 15660; total 189660
  assert.equal(j.totalCostCt, 189660);
  assert.equal(j.remainingDebtCt, 189660);
  assert.equal(j.itemsProcessed, 1);
});

test('api: GET /suppliers/:id/purchases lists receipts', async () => {
  const r = await fetch(`${base}/api/suppliers/9/purchases`);
  assert.equal(r.status, 200);
  const rows = await r.json() as { invoice_number: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].invoice_number, 'BL-API-1');
});

test('api: GET /suppliers/:id/statement aggregates ledger', async () => {
  const r = await fetch(`${base}/api/suppliers/9/statement`);
  assert.equal(r.status, 200);
  const st = await r.json() as { supplierName: string; totalPurchasedCt: number; outstandingCt: number };
  assert.equal(st.supplierName, 'SUP API');
  assert.equal(st.totalPurchasedCt, 189660);
  assert.equal(st.outstandingCt, 189660);
});

test('api: POST /clients/:id/settle decrements ledger with timbre', async () => {
  (baraka as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
    .prepare('INSERT OR IGNORE INTO clients (id, name, phone, credit_balance_ct, max_credit_limit_ct) VALUES (50, ?, ?, 1000000, 0)')
    .run('CLIENT API', '0550999888');
  const r = await fetch(`${base}/api/clients/50/settle`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountCt: 100000, cashierName: 'API' }),
  });
  assert.equal(r.status, 201);
  const j = await r.json() as { success: boolean; newBalanceCt: number; timbreCt: number; receiptNumber: string };
  assert.equal(j.success, true);
  assert.equal(j.newBalanceCt, 900000);
  assert.equal(j.timbreCt, 1000);
  assert.match(j.receiptNumber, /^Q-\d{4}-\d{6}$/);
});

test('api: POST /clients/:id/settle-and-print spools quittance bytes', async () => {
  const r = await fetch(`${base}/api/clients/50/settle-and-print`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountCt: 50000 }),
  });
  assert.equal(r.status, 201);
  const j = await r.json() as { success: boolean; bytes: number; settlement: { newBalanceCt: number } };
  assert.equal(j.success, true);
  assert.ok(j.bytes > 100);
  assert.equal(j.settlement.newBalanceCt, 850000);
  const bad = await fetch(`${base}/api/clients/777/settle`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountCt: 1000 }),
  });
  assert.equal(bad.status, 400);
});

test('api: GET /clients/:id/statement returns ledger history', async () => {
  const r = await fetch(`${base}/api/clients/50/statement`);
  assert.equal(r.status, 200);
  const st = await r.json() as { client: { name: string }; settlements: { amount_ct: number }[]; creditSales: unknown[] };
  assert.equal(st.client.name, 'CLIENT API');
  assert.equal(st.settlements.length, 2);
  assert.deepEqual(st.creditSales, []);
});

test('api: POST /cash/open starts a guarded session', async () => {
  const r = await fetch(`${base}/api/cash/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cashierName: 'API', openingFloatCt: 1000000 }),
  });
  assert.equal(r.status, 201);
  const j = await r.json() as { success: boolean; status: string; openingFloatCt: number };
  assert.equal(j.success, true);
  assert.equal(j.status, 'OPEN');
  const dup = await fetch(`${base}/api/cash/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cashierName: 'API2', openingFloatCt: 1 }),
  });
  assert.equal(dup.status, 400);
});

test('api: GET /cash/active reflects live theoretical cash', async () => {
  const m = await fetch(`${base}/api/cash/movement`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: (await (await fetch(`${base}/api/cash/active`)).json() as { session: { id: string } }).session.id, movementType: 'EXPENSE', amountCt: 50000, reason: 'test depense' }),
  });
  assert.equal(m.status, 201);
  const live = await (await fetch(`${base}/api/cash/active`)).json() as { theoreticalCashCt: number; expensesCt: number };
  assert.equal(live.expensesCt, 50000);
  assert.equal(live.theoreticalCashCt, 950000);
});

test('api: POST /cash/close-and-z finalizes with spooled ticket', async () => {
  const active = await (await fetch(`${base}/api/cash/active`)).json() as { session: { id: string } };
  const r = await fetch(`${base}/api/cash/close-and-z`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: active.session.id, countedCashCt: 940000 }),
  });
  assert.equal(r.status, 201);
  const z = await r.json() as { success: boolean; zNumber: string; bytes: number; cashDiffCt: number; sessionId: string };
  assert.equal(z.success, true);
  assert.match(z.zNumber, /^Z-\d{4}-\d{6}$/);
  assert.ok(z.bytes > 200);
  assert.equal(z.cashDiffCt, -10000);
  assert.equal(await (await fetch(`${base}/api/cash/active`)).json(), null);
});

test('api: POST /security/verify-pin checks the manager gate', async () => {
  const ok = await fetch(`${base}/api/security/verify-pin`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '1234' }),
  });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { success: boolean }).success, true);
  const bad = await fetch(`${base}/api/security/verify-pin`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '0000' }),
  });
  assert.equal(((await bad.json()) as { success: boolean }).success, false);
});

test('api: security void-log + summary round-trip', async () => {
  const w = await fetch(`${base}/api/security/void-log`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      actionType: 'LINE_VOID', productId: 1, productName: 'LAIT',
      amountCt: 145000, cashierName: 'API', managerApprovedBy: 'Hadj', reason: 'api-test',
    }),
  });
  assert.equal(w.status, 201);
  const rows = await (await fetch(`${base}/api/security/void-log?reason=api-test`)).json() as { amountCt: number }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountCt, 145000);
  const sum = await (await fetch(`${base}/api/security/void-summary`)).json() as { totalVoidCount: number };
  assert.ok(sum.totalVoidCount >= 1);
});

test('api: POST /backups/create snapshots with hash, GET lists catalog', async () => {
  const c = await fetch(`${base}/api/backups/create`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'apitest' }),
  });
  assert.equal(c.status, 201);
  const meta = await c.json() as { success: boolean; filename: string; sha256Checksum: string; filePath: string };
  assert.equal(meta.success, true);
  assert.match(meta.filename, /apitest\.sqlite$/);
  assert.match(meta.sha256Checksum, /^[0-9a-f]{64}$/);
  const list = await (await fetch(`${base}/api/backups`)).json() as { filename: string }[];
  assert.ok(list.some(r => r.filename === meta.filename));
});

test('api: POST /backups/verify validates snapshots and rejects garbage', async () => {
  const list = await (await fetch(`${base}/api/backups`)).json() as { filePath: string }[];
  const v = await fetch(`${base}/api/backups/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backupPath: list[0].filePath }),
  });
  assert.equal(v.status, 200);
  const rep = await v.json() as { isValid: boolean; integrityCheckResult: string; errors: string[] };
  assert.equal(rep.isValid, true);
  assert.equal(rep.integrityCheckResult, 'ok');
  const bad = await fetch(`${base}/api/backups/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backupPath: 'data/nope.sqlite' }),
  });
  assert.equal(((await bad.json()) as { isValid: boolean }).isValid, false);
});
