import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from './index.js';
import { loopbackTokenPath } from './index.js';
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

// T4 (ADR-025): the loopback now requires a token for writes. The harness
// auto-attaches it to every same-base POST through a fetch shim, so the 18
// existing write sites stay untouched; negative tests use _rawFetch.
const TOKEN = fs.readFileSync(loopbackTokenPath(TMP), 'utf8').trim();
const _rawFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((url: unknown, init?: RequestInit) => {
  if (typeof url === 'string' && url.startsWith(base) && init?.method === 'POST') {
    init = { ...init, headers: { ...(init.headers as Record<string, string>), 'x-baraka-loopback': TOKEN } };
  }
  return _rawFetch(url as string, init);
}) as typeof fetch;

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

test('api: T4 unauthenticated writes rejected (401), reads stay open', async () => {
  const noAuth: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ header, items }) };
  const denied = await _rawFetch(`${base}/api/sales`, noAuth);
  assert.equal(denied.status, 401);
  const deniedPrint = await _rawFetch(`${base}/api/raw-print`, { ...noAuth, body: JSON.stringify({ hex: '1b700019fa' }) });
  assert.equal(deniedPrint.status, 401);
  const open = await _rawFetch(`${base}/api/products`);
  assert.equal(open.status, 200);
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

test('api: raw-print routes pole labels to the pole spool (T5)', async () => {
  const r = await fetch(`${base}/api/raw-print`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hex: '0c', label: 'pole-display' }),
  });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { spool: string }).spool, 'pole-display-spool.bin');
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

test('api: K9 sessions history lists the closed shift with diff + Z number', async () => {
  const list = await (await fetch(`${base}/api/cash/sessions?limit=5`)).json() as {
    id: string; cashierName: string; status: string; cashDiffCt: number; zReportId: string;
  }[];
  assert.ok(Array.isArray(list) && list.length >= 1);
  const closed = list.find(s => s.status === 'CLOSED');
  assert.ok(closed, 'a CLOSED session is listed');
  assert.equal(closed.cashDiffCt, -10000);
  assert.match(closed.zReportId, /^Z-\d{4}-\d{6}$/);
  const o = await fetch(`${base}/api/cash/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cashierName: 'K9', openingFloatCt: 50000 }),
  });
  assert.equal(o.status, 201);
  const sess = await o.json() as { id: string };
  const list2 = await (await fetch(`${base}/api/cash/sessions?limit=5`)).json() as { id: string; status: string }[];
  assert.equal(list2[0].id, sess.id);
  assert.equal(list2[0].status, 'OPEN');
  const c = await fetch(`${base}/api/cash/close-and-z`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: sess.id, countedCashCt: 50000 }),
  });
  assert.equal(c.status, 201);
});

test('api: F8 movements trail lists the session deposits with reasons', async () => {
  const o = await fetch(`${base}/api/cash/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cashierName: 'F8', openingFloatCt: 10000 }),
  });
  assert.equal(o.status, 201);
  const sess = await o.json() as { id: string };
  const bad = await fetch(`${base}/api/cash/movements`);
  assert.equal(bad.status, 400);
  const empty = await (await fetch(`${base}/api/cash/movements?sessionId=${sess.id}`)).json() as unknown[];
  assert.deepEqual(empty, []);
  const dep = await fetch(`${base}/api/cash/movement`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: sess.id, movementType: 'DEPOSIT', amountCt: 25000, reason: 'appoint F8' }),
  });
  assert.equal(dep.status, 201);
  const trail = await (await fetch(`${base}/api/cash/movements?sessionId=${sess.id}`)).json() as {
    id: string; sessionId: string; type: string; amountCt: number; reason: string; createdAt: string;
  }[];
  assert.equal(trail.length, 1);
  assert.equal(trail[0].type, 'DEPOSIT');
  assert.equal(trail[0].amountCt, 25000);
  assert.equal(trail[0].reason, 'appoint F8');
  const c = await fetch(`${base}/api/cash/close-and-z`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: sess.id, countedCashCt: 35000 }),
  });
  assert.equal(c.status, 201);
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

test('api: GET /reference/templates autofills elio/tango in FR + AR', async () => {
  type Hit = {
    id: number; brandName: string; nameFr: string; nameAr: string; categoryCode: string;
    productCategory: string; defaultTva: number; isWeighable: boolean; defaultUnit: string;
  };
  const get = async (q: string): Promise<Hit[]> =>
    (await (await fetch(`${base}/api/reference/templates?q=${encodeURIComponent(q)}`)).json()) as Hit[];
  const elio = await get('elio');
  assert.ok(elio.length > 0 && elio[0].brandName === 'Elio');
  assert.equal(elio[0].productCategory, 'epicerie');
  assert.equal(elio[0].defaultTva, 0);
  const tango = await get('طانغو');
  assert.ok(tango.length > 0 && tango[0].brandName === 'Tango');
  const ze = await get('زيت');
  assert.ok(ze.length > 0 && ze.every(h => h.nameFr.includes('HUILE') || h.nameAr.includes('زيت')));
  const empty = await get('');
  assert.deepEqual(empty, []);
  const limited = await (await fetch(`${base}/api/reference/templates?q=a&limit=2`)).json() as Hit[];
  assert.ok(limited.length <= 2);
});

test('api: T8 users lane — verify, owner-only create, lockout, audit', async () => {
  const post = async (p: string, body: unknown) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Seeded owner verifies with the default PIN.
  const v = (await (await post('/api/users/verify', { username: 'owner', pin: '1234' })).json()) as { ok: boolean; user: { role: string; must_change_pin: number } };
  assert.equal(v.ok, true);
  assert.equal(v.user.role, 'owner');
  assert.equal(v.user.must_change_pin, 1);
  // Non-owner cannot create users.
  const denied = await post('/api/users', { username: 'sara', role: 'manager', pin: '5678', requesterRole: 'cashier' });
  assert.equal(denied.status, 403);
  // Owner creates a manager; manager verifies.
  const created = await post('/api/users', { username: 'sara', display_name: 'Sara', role: 'manager', pin: '5678', requesterRole: 'owner', actor: 'owner' });
  assert.equal(created.status, 201);
  const vm = await (await post('/api/users/verify', { username: 'sara', pin: '5678' })).json() as { ok: boolean };
  assert.equal(vm.ok, true);
  // Five wrong PINs lock the account.
  for (let i = 0; i < 5; i++) await post('/api/users/verify', { username: 'sara', pin: '0000' });
  const locked = await (await post('/api/users/verify', { username: 'sara', pin: '5678' })).json() as { ok: boolean; locked: boolean };
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, true);
  // Audit trail records the security events.
  const audit = await (await fetch(`${base}/api/audit?limit=50`)).json() as { action: string }[];
  const actions = audit.map(a => a.action);
  for (const a of ['user.create', 'login.ok', 'login.fail', 'login.locked']) assert.ok(actions.includes(a), `audit has ${a}`);
});

test('api: v1.5.1 §3 reset-pin — owner-only temp PIN with forced change', async () => {
  const post = async (p: string, body: unknown) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Fresh cashier for the reset lane (sara is locked by the T8 test above).
  const created = await post('/api/users', { username: 'rim', display_name: 'Rim', role: 'cashier', pin: '2222', requesterRole: 'owner', actor: 'owner' });
  assert.equal(created.status, 201);
  const rim = (await created.json()) as { id: number };
  // Without the loopback token the admin action stays 401 (unlike self-auth /pin).
  const bare = await _rawFetch(`${base}/api/users/reset-pin`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: rim.id, newPin: '4242', requesterRole: 'owner', actor: 'owner' }),
  });
  assert.equal(bare.status, 401);
  // Non-owner role is refused even with a token.
  const denied = await post('/api/users/reset-pin', { userId: rim.id, newPin: '4242', requesterRole: 'manager', actor: 'm' });
  assert.equal(denied.status, 403);
  // Owner reset: old PIN dies, new PIN verifies with forced-change.
  const ok = await post('/api/users/reset-pin', { userId: rim.id, newPin: '4242', requesterRole: 'owner', actor: 'owner' });
  assert.equal(ok.status, 200);
  const dead = (await (await post('/api/users/verify', { username: 'rim', pin: '2222' })).json()) as { ok: boolean };
  assert.equal(dead.ok, false);
  const live = (await (await post('/api/users/verify', { username: 'rim', pin: '4242' })).json()) as { ok: boolean; user: { must_change_pin: number } };
  assert.equal(live.ok, true);
  assert.equal(live.user.must_change_pin, 1);
  // §3 completion: future expiry arms the deadline; past is refused.
  const past = await post('/api/users/reset-pin', { userId: rim.id, newPin: '5151', requesterRole: 'owner', actor: 'owner', expiresAt: '2000-01-01T00:00:00' });
  assert.equal(past.status, 400);
  const fut = await post('/api/users/reset-pin', { userId: rim.id, newPin: '5151', requesterRole: 'owner', actor: 'owner', expiresAt: '2099-12-31T23:59:59' });
  assert.equal(fut.status, 200);
  const users = await (await fetch(`${base}/api/users`)).json() as { id: number; pin_expires_at: string | null }[];
  assert.equal(users.find(u => u.id === rim.id)?.pin_expires_at, '2099-12-31T23:59:59');
  const live2 = (await (await post('/api/users/verify', { username: 'rim', pin: '5151' })).json()) as { ok: boolean };
  assert.equal(live2.ok, true);
  const audit = await (await fetch(`${base}/api/audit?limit=50`)).json() as { action: string; detail: string }[];
  const reset = audit.find(a => a.action === 'pin.reset');
  assert.ok(reset, 'audit has pin.reset');
  assert.ok(!reset!.detail.includes('4242'), 'no PIN digits in audit');
});

test('api: v1.5.1 §4 rotation window — GET default, POST owner-gated + audited', async () => {
  const post = async (p: string, body: unknown) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Default window is 90 (meta unset in the fresh test DB).
  const dflt = (await (await fetch(`${base}/api/users/rotation`)).json()) as { days: number };
  assert.equal(dflt.days, 90);
  // Admin write without the token stays 401 (NOT in SELF_AUTH).
  const bare = await _rawFetch(`${base}/api/users/rotation`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ days: 30, requesterRole: 'owner', actor: 'owner' }),
  });
  assert.equal(bare.status, 401);
  // Non-owner refused even with a token; garbage shapes are 400.
  const denied = await post('/api/users/rotation', { days: 30, requesterRole: 'manager', actor: 'm' });
  assert.equal(denied.status, 403);
  const zero = await post('/api/users/rotation', { days: 0, requesterRole: 'owner', actor: 'owner' });
  assert.equal(zero.status, 400);
  const huge = await post('/api/users/rotation', { days: 400, requesterRole: 'owner', actor: 'owner' });
  assert.equal(huge.status, 400);
  // Owner write persists and is audited; countdown rides the verify payload.
  const ok = await post('/api/users/rotation', { days: 30, requesterRole: 'owner', actor: 'owner' });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { days: number }).days, 30);
  const again = (await (await fetch(`${base}/api/users/rotation`)).json()) as { days: number };
  assert.equal(again.days, 30);
  const live = (await (await post('/api/users/verify', { username: 'owner', pin: '1234' })).json()) as {
    ok: boolean; user: { rotation_due: boolean; rotation_days_left: number };
  };
  assert.equal(live.ok, true);
  assert.equal(live.user.rotation_due, false);
  assert.ok(live.user.rotation_days_left > 20 && live.user.rotation_days_left <= 30);
  const logged = await (await fetch(`${base}/api/audit?limit=50`)).json() as { action: string; detail: string }[];
  assert.ok(logged.some(a => a.action === 'users.rotation_config' && a.detail === 'days=30'), 'window audited');
  // Leave the shared lane DB at the default for the tests after us.
  const back = await post('/api/users/rotation', { days: 90, requesterRole: 'owner', actor: 'owner' });
  assert.equal(back.status, 200);
});

test('api: v1.5.1 B2-5 — second owner needs the requesting owner PIN, doubly audited', async () => {
  const post = async (p: string, body: unknown) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const base1 = { username: 'boss2', display_name: 'Boss Two', role: 'owner', pin: '9999', requesterRole: 'owner', actor: 'owner' };
  // No confirm / wrong confirm / non-owner confirmer — all 400, all audited.
  const none = await post('/api/users', base1);
  assert.equal(none.status, 400);
  const wrong = await post('/api/users', { ...base1, confirmPin: '0000' });
  assert.equal(wrong.status, 400);
  const stranger = await post('/api/users', { ...base1, actor: 'rim', confirmPin: '5151' });
  assert.equal(stranger.status, 400);
  // Correct owner PIN — 201, forced-change armed, double audit row.
  const ok = await post('/api/users', { ...base1, confirmPin: '1234' });
  assert.equal(ok.status, 201);
  const created = (await ok.json()) as { id: number; username: string; role: string; must_change_pin: number };
  assert.equal(created.username, 'boss2');
  assert.equal(created.role, 'owner');
  assert.equal(created.must_change_pin, 1);
  const live = (await (await post('/api/users/verify', { username: 'boss2', pin: '9999' })).json()) as { ok: boolean };
  assert.equal(live.ok, true);
  const logged = await (await fetch(`${base}/api/audit?limit=100`)).json() as { action: string; detail: string; entity_id: string }[];
  const conf = logged.filter(a => a.action === 'owner.confirm' && a.detail.includes('second-owner:boss2'));
  assert.equal(conf.filter(a => a.detail.endsWith(' ok')).length, 1);
  assert.ok(conf.filter(a => a.detail.endsWith('rejected')).length >= 3, 'every refusal audited');
  assert.ok(logged.some(a => a.action === 'user.create' && a.entity_id === 'boss2'), 'creation itself audited');
});

test('api: T8 self-auth posts work WITHOUT the loopback token; the rest stay gated', async () => {
  // Negative path: _rawFetch bypasses the file's token-injecting fetch shim.
  const bare = (p: string, body: unknown) =>
    _rawFetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // verify without token: owner still has PIN 1234 in the test DB seed path
  // (fresh DB per file run) — must_change_pin forces the shape, not a 401.
  const v = await bare('/api/users/verify', { username: 'owner', pin: '1234' });
  assert.notEqual(v.status, 401);
  const j = (await v.json()) as { ok: boolean; user?: { must_change_pin: number } };
  assert.equal(j.ok, true);
  assert.equal(j.user?.must_change_pin, 1);
  // wrong PIN without token => 401 verdict (locked:false), NOT "token required".
  const w = ((await (await bare('/api/users/verify', { username: 'owner', pin: '0000' })).json()) as { locked: boolean; ok: boolean });
  assert.equal(w.ok, false);
  // create WITHOUT token stays 401 even with owner role claimed.
  const c = await bare('/api/users', { username: 'mallory', role: 'manager', pin: '1111', requesterRole: 'owner' });
  assert.equal(c.status, 401);
});

test('api: CORS preflight passes on the loopback; token gate intact', async () => {
  const pre = await _rawFetch(`${base}/api/users/verify`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  const get = await _rawFetch(`${base}/api/users`);
  assert.equal(get.headers.get('access-control-allow-origin'), '*');
});

test('api: v1.5.0 returns round-trip — draft → approve → GET, 401 without token, RET numbered', async () => {
  // A shift may already be open from an earlier test — either way we need
  // one live session for the ESPECES refund movement.
  const o = await fetch(`${base}/api/cash/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cashierName: 'RET-API', openingFloatCt: 1000000 }),
  });
  assert.ok(o.status === 201 || o.status === 400, `cash/open usable (got ${o.status})`);
  let sessId: string | null = null;
  if (o.status === 201) {
    sessId = (await o.json() as { id: string }).id;
  } else {
    const live = await (await fetch(`${base}/api/cash/active`)).json() as { session: { id: string } } | null;
    sessId = live?.session?.id ?? null;
  }
  const today = { ...header, created_at: new Date().toISOString() };
  const s = await (await fetch(`${base}/api/sales`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ header: today, items, clientSaleKey: `RET-API-${Date.now().toString(36)}` }),
  })).json() as { id: string };
  const itemIds = (baraka.db.prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC').all(s.id) as { id: number }[]).map(r => r.id);
  assert.equal(itemIds.length, 4);
  // unauthenticated write refused
  const denied = await _rawFetch(`${base}/api/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sale_id: s.id, lines: [{ saleItemId: itemIds[0], qty_milli: 2000 }], reason: 'DEFECT', actor: 'lina' }),
  });
  assert.equal(denied.status, 401);
  // draft (201, no RET number yet)
  const d = await (await fetch(`${base}/api/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sale_id: s.id, lines: [{ saleItemId: itemIds[0], qty_milli: 2000 }], reason: 'DEFECT', actor: 'lina' }),
  })).json() as { id: string; refund_ct: number };
  assert.equal(d.refund_ct, 36000);
  const g0 = await (await fetch(`${base}/api/returns/${d.id}`)).json() as { status: string; return_number: null };
  assert.equal(g0.status, 'DRAFT');
  assert.equal(g0.return_number, null);
  // approve mints RET
  const a = await (await fetch(`${base}/api/returns/${d.id}/approve`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approver: 'karim', approver_role: 'manager' }),
  })).json() as { return_number: string; refund_ct: number };
  assert.match(a.return_number, /^RET-\d{4}-\d{6}$/);
  assert.equal(a.refund_ct, 36000);
  // list + audit
  const list = await (await fetch(`${base}/api/returns?status=APPROVED`)).json() as { id: string }[];
  assert.ok(list.some(r => String(r.id) === String(d.id)), 'approved return listed');
  const audit = await (await fetch(`${base}/api/audit?limit=100`)).json() as { action: string; actor: string }[];
  assert.ok(audit.some(x => x.action === 'return.approve' && x.actor === 'karim'), 'return.approve audited');
  // Leave the lane as we found it: close the shift we opened so the T10/B4
  // close-and-z tests below still own a fresh session.
  if (sessId) {
    await fetch(`${base}/api/cash/close-and-z`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessId, countedCashCt: 1000000, actor: 'ret-api' }),
    });
  }
});
test('api: T10 void writes a sale.void audit row (actor + reason)', async () => {
  const s = await (await fetch(`${base}/api/sales`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ header, items, clientSaleKey: `T10-VOID-${Date.now().toString(36)}` }),
  })).json() as { id: string };
  const v = await fetch(`${base}/api/sales/${s.id}/void`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 't10-test', by: 't10-owner' }),
  });
  assert.equal(v.status, 200);
  const audit = await (await fetch(`${base}/api/audit?limit=100`)).json() as { action: string; actor: string }[];
  const row = audit.find(a => a.action === 'sale.void' && a.actor === 't10-owner');
  assert.ok(row, 'sale.void audit row present');
});

test('api: T10 close-and-z writes a z.close audit row', async () => {
  const o = await fetch(`${base}/api/cash/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cashierName: 'T10', openingFloatCt: 100000 }),
  });
  assert.equal(o.status, 201);
  const sess = await o.json() as { id: string };
  const c = await fetch(`${base}/api/cash/close-and-z`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: sess.id, countedCashCt: 100000, actor: 't10-owner' }),
  });
  assert.equal(c.status, 201);
  const audit = await (await fetch(`${base}/api/audit?limit=100`)).json() as { action: string; actor: string }[];
  const row = audit.find(a => a.action === 'z.close' && a.actor === 't10-owner');
  assert.ok(row, 'z.close audit row present');
});

test('api: B4 close-and-z with notes stores the gap reason in the z.close audit detail', async () => {
  const o = await fetch(`${base}/api/cash/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cashierName: 'B4', openingFloatCt: 100000 }),
  });
  assert.equal(o.status, 201);
  const sess = await o.json() as { id: string };
  const c = await fetch(`${base}/api/cash/close-and-z`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: sess.id, countedCashCt: 99900, actor: 'b4-owner', notes: 'erreur de rendu' }),
  });
  assert.equal(c.status, 201);
  const audit = await (await fetch(`${base}/api/audit?limit=100`)).json() as { action: string; actor: string; detail: string }[];
  const row = audit.find(a => a.action === 'z.close' && a.actor === 'b4-owner');
  assert.ok(row && row.detail.includes('reason=erreur de rendu'), 'gap reason persisted in audit');
});

test('api: v1.5.2 sales book — day list newest-first, bad day 400', async () => {
  const mk = async (cashier: string) => {
    const r = await fetch(`${base}/api/sales`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        header: { ...header, cashier_name: cashier, created_at: new Date().toISOString() },
        items,
      }),
    });
    assert.equal(r.status, 201);
    return (await r.json()) as { id: string; invoice_number: string };
  };
  const a = await mk('SB-A');
  const c = await mk('SB-C');
  const day = new Date().toISOString().slice(0, 10);
  // NOTE: day bucket is Africa/Algiers — CI midnight edges could shift; assert
  // membership rather than exact set when the two sales straddle midnight.
  const list = await (await fetch(`${base}/api/sales/day/${day}`)).json() as { id: string; invoice_number: string; total_ttc_ct: number; status: string }[];
  assert.ok(Array.isArray(list) && list.length >= 2, 'day list carries the fresh sales');
  const ids = list.map(x => x.id);
  assert.ok(ids.includes(a.id) && ids.includes(c.id), 'both sales present');
  assert.ok(list[0].invoice_number >= list[1].invoice_number, 'newest first');
  assert.equal(typeof list[0].total_ttc_ct, 'number');
  const bad = await fetch(`${base}/api/sales/day/nope`);
  assert.equal(bad.status, 400);
});

test('api: v1.5.2 sales book — duplicata posts sale.duplicata audit, 404 unknown', async () => {
  const ghost = await fetch(`${base}/api/sales/does-not-exist/duplicata`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ by: 'sb-owner' }),
  });
  assert.equal(ghost.status, 404);
  const r = await fetch(`${base}/api/sales`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ header: { ...header, created_at: new Date().toISOString() }, items }),
  });
  assert.equal(r.status, 201);
  const sale = (await r.json()) as { id: string };
  const d = await fetch(`${base}/api/sales/${sale.id}/duplicata`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ by: 'sb-owner', reason: 'client perdu' }),
  });
  assert.equal(d.status, 200);
  const audit = await (await fetch(`${base}/api/audit?limit=100`)).json() as { action: string; actor: string; detail: string; entity_id: string }[];
  const row = audit.find(x => x.action === 'sale.duplicata' && x.actor === 'sb-owner');
  assert.ok(row && row.entity_id === sale.id && row.detail.includes('client perdu'), 'duplicata audit row present with reason');
});
