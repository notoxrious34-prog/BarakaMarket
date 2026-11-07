import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from './sqlite.js';

// NOTE: C: is 100% full on this machine -> test DBs live under repo data/.tmp-tests (D:).
const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
let n = 0;
const tmpFile = (tag: string) => {
  n += 1;
  const p = path.join(TMP, `claims-${tag}-${process.pid}-${n}.db`);
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* fresh */ }
  }
  return p;
};

const PROD = {
  id: 3, barcode: '300000000003', name_fr: 'LAIT', name_ar: 'حليب',
  category_id: 'laiterie', buy_price_ct: 12000, sell_price_ct: 18000,
  tva_rate: 9 as const, stock_milli: 50000, min_stock_milli: 5000,
  unit: 'PIECE' as const, is_scale: 0, scale_item_code: null,
  has_expiry: 1, expiry_date: '2026-12-15',
};

const cleanup = (p: string) => {
  for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(p + suf); } catch { /* x */ } }
};

test('R-bridge: claim files with buy-cost valuation, numbered CLM; guards hold', () => {
  const p = tmpFile('create');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    // 2000 milli at buy 12000 -> 24000 ct valuation.
    const c = b.createSupplierClaim({
      supplier_id: 9, supplier_name: 'SOUMAM', product_id: 3,
      qty_milli: 2000, reason: 'DEFECT', note: 'briques gonflées', actor: 'lina',
    });
    assert.match(c.claim_number, /^CLM-\d{4}-\d{6}$/);
    assert.equal(c.total_cost_ct, 24000);
    const rows = b.listSupplierClaims('OPEN');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].claim_number, c.claim_number);
    // Guards: bad reason, bad qty, missing actor, unknown product.
    assert.throws(() => b.createSupplierClaim({
      supplier_id: 9, supplier_name: 'SOUMAM', qty_milli: 100, reason: 'BURN' as never, actor: 'lina',
    }), /bad claim reason/);
    assert.throws(() => b.createSupplierClaim({
      supplier_id: 9, supplier_name: 'SOUMAM', qty_milli: 0, reason: 'DEFECT', actor: 'lina',
    }), /qty_milli/);
    assert.throws(() => b.createSupplierClaim({
      supplier_id: 9, supplier_name: 'SOUMAM', qty_milli: 100, reason: 'DEFECT', actor: '  ',
    }), /actor/);
    assert.throws(() => b.createSupplierClaim({
      supplier_id: 9, supplier_name: 'SOUMAM', product_id: 4242, qty_milli: 100, reason: 'DEFECT', actor: 'lina',
    }), /claim product not found/);
    b.close();
  } finally { cleanup(p); }
});

test('R-bridge: settle needs manager+; CREDIT_NOTE books the avoir on the supplier ledger', () => {
  const p = tmpFile('settle');
  try {
    const b = openBarakaDb(p);
    b.upsertProduct(PROD);
    const c = b.createSupplierClaim({
      supplier_id: 9, supplier_name: 'SOUMAM', product_id: 3,
      qty_milli: 2000, reason: 'DEFECT', actor: 'lina',
    });
    // Cashier cannot close a claim.
    assert.throws(() => b.settleSupplierClaim(c.id, 'REPLACED', 'yacine', 'cashier'), /manager or owner/);
    // REPLACED settles with no money move.
    b.settleSupplierClaim(c.id, 'REPLACED', 'karim', 'manager');
    assert.equal(b.listSupplierClaims('OPEN').length, 0);
    assert.equal(b.listSupplierClaims('SETTLED').length, 1);
    assert.throws(() => b.settleSupplierClaim(c.id, 'REFUNDED', 'karim', 'manager'), /already settled/);
    // CREDIT_NOTE without a supplier ledger row is a loud refusal, never silent.
    const c2 = b.createSupplierClaim({
      supplier_id: 9, supplier_name: 'SOUMAM', product_id: 3,
      qty_milli: 1000, reason: 'EXPIRED', actor: 'lina',
    });
    assert.throws(() => b.settleSupplierClaim(c2.id, 'CREDIT_NOTE', 'karim', 'manager'), /no ledger row/);
    assert.equal(b.listSupplierClaims('OPEN').length, 1);
    // With a ledger row, the avoir shrinks what we owe — exact, same txn.
    b.db.prepare('INSERT INTO suppliers (id, name, balance_due_ct) VALUES (9, ?, 500000)').run('SOUMAM');
    b.settleSupplierClaim(c2.id, 'CREDIT_NOTE', 'karim', 'manager');
    const bal = (b.db.prepare('SELECT balance_due_ct FROM suppliers WHERE id = 9').get() as { balance_due_ct: number }).balance_due_ct;
    assert.equal(bal, 500000 - 12000); // 1000 milli at buy 12000
    const audit = b.listAudit(50).find(r => r.action === 'claim.settle');
    assert.ok(audit && audit.detail.includes('CREDIT_NOTE') && audit.detail.includes('avoir-12000'));
    b.close();
  } finally { cleanup(p); }
});
