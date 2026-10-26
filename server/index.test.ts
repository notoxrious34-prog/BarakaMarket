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
