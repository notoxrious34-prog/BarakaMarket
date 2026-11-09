import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from './sqlite.js';
import { fiscalDayISO } from '../core/fiscal-day.js';
import { calculateLineTotalsCt, calculateSaleTotalsCt } from '../core/fiscal.centimes.js';

// NOTE: C: is 100% full on this machine -> test DBs live under repo data/.tmp-tests (D:).
const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
let n = 0;
const tmpFile = (tag: string) => {
  n += 1;
  const p = path.join(TMP, `salesbook-${tag}-${process.pid}-${n}.db`);
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* fresh */ }
  }
  return p;
};

const PROD = {
  id: 1, barcode: '6130000000014', name_fr: 'LAIT CONDENSE', name_ar: 'حليب',
  category_id: 'laiterie', buy_price_ct: 14500, sell_price_ct: 18000,
  tva_rate: 9 as const, stock_milli: 48000, min_stock_milli: 10000,
  unit: 'PIECE' as const, is_scale: 0, scale_item_code: null,
  has_expiry: 0, expiry_date: null,
};

function recordSale(b: ReturnType<typeof openBarakaDb>, clientId: number | null) {
  const a = calculateLineTotalsCt(18000, 2, 9);
  const totals = calculateSaleTotalsCt([{ tva_rate: 9 as const, ...a }], 'ESPECES');
  return b.recordSale(
    {
      cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES',
      amount_paid_ct: (totals as { total_ttc_ct: number }).total_ttc_ct,
      amount_returned_ct: 0, totals: totals as never,
      client_id: clientId, created_at: new Date().toISOString(),
    },
    [{
      product_id: 1, barcode: 'a', name_fr: 'LAIT', name_ar: '', unit_price_ct: 18000,
      qty_milli: 2000, unit: 'PIECE' as const, tva_rate: 9 as const, discount_bp: 0,
      line_ht_ct: a.total_line_ht_ct, line_tva_ct: a.total_line_tva_ct, line_ttc_ct: a.total_line_ttc_ct,
    }],
  );
}

test('v1.5.2: listSalesByDay — newest first, client name, CANCELLED visible, empty day []', () => {
  const b = openBarakaDb(tmpFile('day'));
  try {
    b.upsertProduct(PROD);
    b.openCashSession('Amine', 1000000);
    b.db.prepare("INSERT INTO clients (name, phone, address) VALUES ('Karim', '055', 'Alger')").run();
    const s1 = recordSale(b, 1);
    const s2 = recordSale(b, null);
    b.voidSale(s2.id, 'test void', 'Amine');

    const day = fiscalDayISO(new Date());
    const rows = b.listSalesByDay(day);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, s2.id, 'newest first');
    assert.equal(rows[0].status, 'CANCELLED');
    assert.equal(rows[1].id, s1.id);
    assert.equal(rows[1].client_name, 'Karim');
    assert.equal(rows[1].has_approved_return, 0);

    assert.deepEqual(b.listSalesByDay('2000-01-01'), []);
    assert.throws(() => b.listSalesByDay('nope'), /YYYY-MM-DD/);
  } finally { b.close(); }
});

test('v1.5.2: listSalesByDay — approved return flips the AVOIR flag', () => {
  const b = openBarakaDb(tmpFile('avoir'));
  try {
    b.upsertProduct(PROD);
    b.openCashSession('Amine', 1000000);
    const sale = recordSale(b, null);
    const [lineId] = (b.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').all(sale.id) as { id: number }[]).map(r => r.id);
    const d = b.createReturnDraft({ sale_id: sale.id, lines: [{ saleItemId: lineId, qty_milli: 2000 }], reason: 'DEFECT', actor: 'Amine', client_return_key: 'SB-K1' });
    b.approveReturn(d.id, 'boss', 'owner');
    const rows = b.listSalesByDay(fiscalDayISO(new Date()));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].has_approved_return, 1);
  } finally { b.close(); }
});
