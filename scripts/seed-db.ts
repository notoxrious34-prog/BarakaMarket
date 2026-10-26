/**
 * Build a fresh baraka.db from src/data/seedData.ts (legacy floats -> ct/milli).
 * Usage: npx tsx scripts/seed-db.ts [out.db]   (default: data/baraka.db)
 * The output is gitignored (data/) and regenerated on demand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from '../src/db/sqlite.js';
import { dzdToCentimes } from '../src/core/money.js';
import { clientToRow, productToRow, qtyToMilli, supplierToRow } from './convert-legacy.js';
import {
  initialClients,
  initialProducts,
  initialPurchases,
  initialStoreProfile,
  initialSuppliers,
} from '../src/data/seedData.js';

const out = path.resolve(process.argv[2] ?? 'data/baraka.db');
for (const suf of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(out + suf); } catch { /* fresh */ }
}

const b = openBarakaDb(out);
const sp = initialStoreProfile;
b.db.prepare(
  `INSERT INTO store_profile (id, store_name, company_owner, rc_number, nif_number, nis_number,
    ai_number, address, phone, currency, receipt_footer, timbre_rate, timbre_min_ct, timbre_max_ct)
   VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  sp.store_name, sp.company_owner, sp.rc_number, sp.nif_number, sp.nis_number, sp.ai_number,
  sp.address, sp.phone, sp.currency, sp.receipt_footer, sp.timbre_rate,
  dzdToCentimes(sp.timbre_min), dzdToCentimes(sp.timbre_max),
);

let nP = 0;
for (const p of initialProducts) { b.upsertProduct(productToRow(p)); nP++; }

const insClient = b.db.prepare(
  `INSERT INTO clients (id, name, phone, address, nif, nis, rc, ai, credit_balance_ct, max_credit_limit_ct, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
let nC = 0;
for (const c of initialClients) {
  const r = clientToRow(c);
  insClient.run(r.id, r.name, r.phone, r.address, r.nif, r.nis, r.rc, r.ai, r.credit_balance_ct, r.max_credit_limit_ct, r.notes);
  nC++;
}

const insSupplier = b.db.prepare(
  `INSERT INTO suppliers (id, name, contact_person, phone, address, nif, nis, rc, ai, balance_due_ct, payment_terms, category)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
let nS = 0;
for (const s of initialSuppliers) {
  const r = supplierToRow(s);
  insSupplier.run(r.id, r.name, r.contact_person, r.phone, r.address, r.nif, r.nis, r.rc, r.ai, r.balance_due_ct, r.payment_terms, r.category);
  nS++;
}

const insPurch = b.db.prepare(
  `INSERT INTO purchases (id, invoice_number, supplier_id, supplier_name, total_ht_ct, total_tva_ct,
    total_ttc_ct, payment_method, amount_paid_ct, amount_due_ct, date, note)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insPurchItem = b.db.prepare(
  `INSERT INTO purchase_items (purchase_id, product_id, barcode, name_fr, name_ar, qty_milli, unit,
    unit_buy_price_ht_ct, tva_rate, unit_sell_price_ttc_ct, line_ht_ct, line_ttc_ct)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
let nPu = 0, nPi = 0;
for (const pu of initialPurchases) {
  insPurch.run(pu.id, pu.invoice_number, pu.supplier_id, pu.supplier_name,
    dzdToCentimes(pu.total_ht), dzdToCentimes(pu.total_tva), dzdToCentimes(pu.total_ttc),
    pu.payment_method, dzdToCentimes(pu.amount_paid), dzdToCentimes(pu.amount_due), pu.date, pu.note ?? null);
  nPu++;
  for (const it of pu.items) {
    insPurchItem.run(pu.id, it.product_id, it.barcode, it.name_fr, it.name_ar,
      qtyToMilli(it.quantity), it.unit, dzdToCentimes(it.unit_buy_price_ht),
      it.tva_rate, dzdToCentimes(it.unit_sell_price_ttc),
      dzdToCentimes(it.total_line_ht), dzdToCentimes(it.total_line_ttc));
    nPi++;
  }
}

const counts = {
  products: (b.db.prepare('SELECT COUNT(*) c FROM products').get() as { c: number }).c,
  clients: (b.db.prepare('SELECT COUNT(*) c FROM clients').get() as { c: number }).c,
  suppliers: (b.db.prepare('SELECT COUNT(*) c FROM suppliers').get() as { c: number }).c,
  purchases: (b.db.prepare('SELECT COUNT(*) c FROM purchases').get() as { c: number }).c,
  pragmas: b.pragmas(),
};
b.close();
const bytes = fs.statSync(out).size;
console.log(JSON.stringify({ out, seeded: { products: nP, clients: nC, suppliers: nS, purchases: nPu, purchase_items: nPi }, counts, bytes }, null, 2));
