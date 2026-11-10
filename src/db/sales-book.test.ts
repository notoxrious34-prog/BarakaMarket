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

test('v1.5.2 P3: filterSalesBookRows — q/cashier/pay/flag/client (pure)', async () => {
  const { filterSalesBookRows, salesBookCashiers, EMPTY_SALES_BOOK_FILTERS } =
    await import('../core/sales-book-authority.js');
  const R = (o: Partial<import('../core/sales-book-authority.js').SalesBookRow>) =>
    ({
      id: 'x', invoice_number: 'FACT-2026-000001', ticket_number: 'T-1',
      created_at: '2026-11-10T10:00:00.000Z', cashier_name: 'Amine',
      payment_method: 'ESPECES', total_ttc_ct: 10000, status: 'COMPLETED',
      client_name: null, has_approved_return: 0 as const, avoir_total_ct: 0, ...o,
    });
  const rows = [
    R({ id: 'a', invoice_number: 'FACT-2026-000042', payment_method: 'CIB', client_name: 'Karim', has_approved_return: 1 as const, avoir_total_ct: 5000 }),
    R({ id: 'b', invoice_number: 'FACT-2026-000043', cashier_name: 'Mounir', status: 'CANCELLED' }),
    R({ id: 'c', invoice_number: 'FACT-2026-000044', payment_method: 'CREDIT', client_name: 'Sami' }),
  ];
  const F = (o: object) => ({ ...EMPTY_SALES_BOOK_FILTERS, ...o });
  assert.equal(filterSalesBookRows(rows, F({ q: '42' })).length, 1);
  assert.equal(filterSalesBookRows(rows, F({ q: 'fact-2026-000043' }))[0].id, 'b', 'case-insensitive');
  assert.deepEqual(filterSalesBookRows(rows, F({ cashier: 'Mounir' })).map(r => r.id), ['b']);
  assert.deepEqual(filterSalesBookRows(rows, F({ pay: 'CREDIT' })).map(r => r.id), ['c']);
  assert.deepEqual(filterSalesBookRows(rows, F({ flag: 'avoir' })).map(r => r.id), ['a']);
  assert.deepEqual(filterSalesBookRows(rows, F({ flag: 'cancelled' })).map(r => r.id), ['b']);
  assert.deepEqual(filterSalesBookRows(rows, F({ client: 'named' })).map(r => r.id), ['a', 'c']);
  assert.deepEqual(filterSalesBookRows(rows, F({ client: 'walkin' })).map(r => r.id), ['b']);
  assert.equal(filterSalesBookRows(rows, F({})) .length, 3);
  assert.deepEqual(salesBookCashiers(rows), ['Amine', 'Mounir']);
});

test('v1.5.2 P4: computeSalesBookHealth — cancelled apart, net = gross − avoir (pure)', async () => {
  const { computeSalesBookHealth } = await import('../core/sales-book-authority.js');
  const R = (o: Partial<import('../core/sales-book-authority.js').SalesBookRow>) =>
    ({
      id: 'x', invoice_number: 'F', ticket_number: 'T',
      created_at: '2026-11-10T10:00:00.000Z', cashier_name: 'Amine',
      payment_method: 'ESPECES', total_ttc_ct: 0, status: 'COMPLETED',
      client_name: null, has_approved_return: 0 as const, avoir_total_ct: 0, ...o,
    });
  const h = computeSalesBookHealth([
    R({ payment_method: 'ESPECES', total_ttc_ct: 37000, avoir_total_ct: 0 }),
    R({ payment_method: 'CIB', total_ttc_ct: 30000, avoir_total_ct: 10000, has_approved_return: 1 as const }),
    R({ payment_method: 'ESPECES', total_ttc_ct: 5000, status: 'CANCELLED' }),
  ]);
  assert.equal(h.count, 2);
  assert.equal(h.cancelled, 1, 'cancelled never inside the gross');
  assert.equal(h.gross_ct, 67000);
  assert.equal(h.avoir_ct, 10000);
  assert.equal(h.net_ct, 57000);
  assert.equal(h.especes_ct, 37000);
  assert.equal(h.bank_ct, 30000);
  assert.equal(h.credit_ct, 0);
});

test('v1.5.2 P3: buildSalesBookCsv — BOM + semicolons + DZD decimals (pure)', async () => {
  const { buildSalesBookCsv } = await import('../core/sales-book-authority.js');
  const rows = [{
    id: 'x', invoice_number: 'FACT-2026-000042', ticket_number: 'T-42',
    created_at: '2026-11-10T10:05:00.000Z', cashier_name: 'Am;ine',
    payment_method: 'ESPECES', total_ttc_ct: 37000, status: 'COMPLETED',
    client_name: null, has_approved_return: 0 as const, avoir_total_ct: 0,
  }];
  const fr = buildSalesBookCsv(rows, '2026-11-10', 'fr');
  assert.ok(fr.startsWith('﻿'), 'BOM first for Excel');
  assert.ok(fr.includes('Facture;Ticket;Heure'), 'FR header');
  assert.ok(fr.includes('"Am;ine"'), 'semicolon quoting');
  assert.ok(fr.includes('370,00'), 'DZD decimals with comma');
  const ar = buildSalesBookCsv(rows, '2026-11-10', 'ar');
  assert.ok(ar.includes('الوصل;التذكرة') && ar.includes('عابر'), 'AR header + walk-in label');
});
