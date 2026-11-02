/**
 * Migrate a browser-localStorage dump (legacy float DZD) into SQLite centimes.
 * Usage: npx tsx scripts/migrate-localstorage.ts <dump.json> <out.db>
 * Dump shape: { products?, clients?, suppliers?, sales? } using the app's
 * legacy types (floats). Money is canonicalized through the deterministic
 * engine (HT = round(TTC*100/(100+taux))); lines adjusted by <=1ct are counted
 * and reported, never silently fudged beyond that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from '../src/db/sqlite.js';
import { dzdToCentimes } from '../src/core/money.js';
import { calculateTimbreFiscalCt } from '../src/core/fiscal.centimes.js';
import { clientToRow, productToRow, qtyToMilli, supplierToRow } from './convert-legacy.js';

const [dumpPath, outDb, flag] = process.argv.slice(2);
if (!dumpPath || !outDb) {
  console.error('Usage: tsx scripts/migrate-localstorage.ts <dump.json> <out.db> [--force]');
  process.exit(1);
}
const force = flag === '--force';
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8')) as Record<string, Array<Record<string, never>>>;
const out = path.resolve(outDb);

// #003 one-shot guard: never silently bulldoze a live database. A second
// run without --force refuses; --force wipes and rebuilds deterministically.
{
  let sales = 0;
  try {
    const probe = openBarakaDb(out);
    try { sales = (probe.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n; }
    finally { probe.close(); }
  } catch { /* fresh file or no schema yet */ }
  if (sales > 0 && !force) {
    console.error(`[migrate] REFUSED: ${out} already holds ${sales} sale(s) — pass --force to rebuild`);
    process.exit(2);
  }
}
for (const suf of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(out + suf); } catch { /* fresh */ }
}

const b = openBarakaDb(out);
const stats = { products: 0, clients: 0, suppliers: 0, sales: 0, sale_items: 0, lines_adjusted_1ct: 0, timbre_diffs: 0, seq_reseeded: 0 };

for (const p of dump.products ?? []) {
  b.upsertProduct(productToRow(p as never));
  stats.products++;
}
const insClient = b.db.prepare(
  'INSERT INTO clients (id, name, phone, address, nif, nis, rc, ai, credit_balance_ct, max_credit_limit_ct, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
for (const c of dump.clients ?? []) {
  const r = clientToRow(c as never);
  insClient.run(r.id, r.name, r.phone, r.address, r.nif, r.nis, r.rc, r.ai, r.credit_balance_ct, r.max_credit_limit_ct, r.notes);
  stats.clients++;
}
const insSupplier = b.db.prepare(
  'INSERT INTO suppliers (id, name, contact_person, phone, address, nif, nis, rc, ai, balance_due_ct, payment_terms, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
for (const s of dump.suppliers ?? []) {
  const r = supplierToRow(s as never);
  insSupplier.run(r.id, r.name, r.contact_person, r.phone, r.address, r.nif, r.nis, r.rc, r.ai, r.balance_due_ct, r.payment_terms, r.category);
  stats.suppliers++;
}

// Legacy sales: keep original invoice/ticket numbers + status, canonicalize money.
const insSale = b.db.prepare(
  `INSERT INTO sales (id, invoice_number, ticket_number, cashier_id, cashier_name, client_id,
    client_name, client_nis, client_rc, client_ai, client_address, client_nif,
    total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct,
    tva0_base_ct, tva0_amt_ct, tva0_ttc_ct, tva9_base_ct, tva9_amt_ct, tva9_ttc_ct,
    tva19_base_ct, tva19_amt_ct, tva19_ttc_ct,
    payment_method, amount_paid_ct, amount_returned_ct, status, is_facture, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insItem = b.db.prepare(
  'INSERT INTO sale_items (sale_id, product_id, barcode, name_fr, name_ar, unit_price_ct, qty_milli, unit, tva_rate, discount_bp, line_ht_ct, line_tva_ct, line_ttc_ct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
interface LegacyItem {
  product_id: number; barcode?: string | number; name_fr?: string; name_ar?: string;
  unit_price_ttc: number; quantity: number; unit?: string; tva_rate: number;
  discount_percent?: number; total_line_ht: number; total_line_tva?: number; total_line_ttc: number;
}
interface LegacySale {
  id: string; invoice_number: string; ticket_number: string;
  cashier_id?: string; cashier_name?: string; payment_method?: string;
  amount_paid?: number; amount_returned?: number; timbre_fiscal?: number;
  status?: string; is_facture_reglementaire?: boolean; created_at?: string;
  client_id?: number; client_name?: string; client_nif?: string; client_nis?: string;
  client_rc?: string; client_ai?: string; client_address?: string;
  items: LegacyItem[];
}
const legacySales = (dump.sales ?? []) as unknown as LegacySale[];
for (const s of legacySales) {
  const items = s.items;
  const tier: Record<number, { b: number; a: number; t: number }> = { 0: { b: 0, a: 0, t: 0 }, 9: { b: 0, a: 0, t: 0 }, 19: { b: 0, a: 0, t: 0 } };
  let sumHt = 0, sumTva = 0, sumTtc = 0;
  const canon = items.map((it) => {
    const rate = it.tva_rate as number;
    const ttc = dzdToCentimes(it.total_line_ttc);
    const ht = Math.round((ttc * 100) / (100 + rate));
    const tva = ttc - ht;
    const legacyHt = dzdToCentimes(it.total_line_ht);
    if (Math.abs(legacyHt - ht) > 1) throw new Error(`[migrate] line drift >1ct in sale ${s.id}`);
    if (legacyHt !== ht) stats.lines_adjusted_1ct++;
    sumHt += ht; sumTva += tva; sumTtc += ttc;
    tier[rate].b += ht; tier[rate].a += tva; tier[rate].t += ttc;
    return {
      product_id: it.product_id, barcode: String(it.barcode ?? ''), name_fr: String(it.name_fr ?? ''),
      name_ar: String(it.name_ar ?? ''), unit_price_ct: dzdToCentimes(it.unit_price_ttc),
      qty_milli: qtyToMilli(it.quantity), unit: String(it.unit ?? 'PIECE'),
      tva_rate: rate, discount_bp: Math.round((it.discount_percent ?? 0) * 100),
      line_ht_ct: ht, line_tva_ct: tva, line_ttc_ct: ttc,
    };
  });
  const pm = String(s.payment_method ?? 'ESPECES');
  const timbre = pm === 'ESPECES' ? calculateTimbreFiscalCt(sumTtc, 'ESPECES') : 0;
  if (timbre !== dzdToCentimes(s.timbre_fiscal ?? 0)) stats.timbre_diffs++;
  insSale.run(
    String(s.id), String(s.invoice_number), String(s.ticket_number), String(s.cashier_id ?? ''), String(s.cashier_name ?? ''),
    s.client_id ?? null, s.client_name ?? null, s.client_nis ?? null,
    s.client_rc ?? null, s.client_ai ?? null, s.client_address ?? null,
    s.client_nif ?? null,
    sumHt, sumTva, timbre, sumTtc + timbre,
    tier[0].b, tier[0].a, tier[0].t, tier[9].b, tier[9].a, tier[9].t, tier[19].b, tier[19].a, tier[19].t,
    pm, dzdToCentimes(s.amount_paid ?? 0), dzdToCentimes(s.amount_returned ?? 0),
    String(s.status ?? 'COMPLETED'), s.is_facture_reglementaire ? 1 : 0, String(s.created_at ?? new Date().toISOString()));
  for (const it of canon) {
    insItem.run(s.id, it.product_id, it.barcode, it.name_fr, it.name_ar, it.unit_price_ct, it.qty_milli, it.unit, it.tva_rate, it.discount_bp, it.line_ht_ct, it.line_tva_ct, it.line_ttc_ct);
    stats.sale_items++;
  }
  stats.sales++;
}

// #003 single-lane numbering: the migrated numbers are history — reseed the
// seq counters to their maxima so the next minted FACT/T continues the lane
// instead of colliding with a migrated invoice.
{
  const seen = new Map<string, number>();
  for (const s of legacySales) {
    for (const n of [String(s.invoice_number), String(s.ticket_number)]) {
      const m = /^(FACT|T|Q|Z)-(\d{4})-(\d+)$/.exec(n);
      if (!m) continue;
      const key = `${m[1]}|${m[2]}`;
      seen.set(key, Math.max(seen.get(key) ?? 0, parseInt(m[3], 10)));
    }
  }
  const reseed = b.db.prepare(
    `INSERT INTO seq (kind, year, last_n) VALUES (?, ?, ?)
     ON CONFLICT (kind, year) DO UPDATE SET last_n = max(seq.last_n, excluded.last_n)`);
  for (const [key, maxN] of seen) {
    const [kind, year] = key.split('|');
    reseed.run(kind, parseInt(year, 10), maxN);
  }
  stats.seq_reseeded = seen.size;
}

// #003 golden-dump equality: recompute from the written DB and refuse to
// report success on any drift from the in-memory canonical sums.
{
  const row = b.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total_ttc_ct), 0) AS t FROM sales').get() as { n: number; t: number };
  const items = (b.db.prepare('SELECT COUNT(*) AS n FROM sale_items').get() as { n: number }).n;
  const memSum = legacySales.reduce((acc, s) => {
    const pm = String(s.payment_method ?? 'ESPECES');
    const ttc = (s.items as LegacyItem[]).reduce((a, it) => a + dzdToCentimes(it.total_line_ttc), 0);
    return acc + ttc + (pm === 'ESPECES' ? calculateTimbreFiscalCt(ttc, 'ESPECES') : 0);
  }, 0);
  const memItems = legacySales.reduce((a, s) => a + (s.items as LegacyItem[]).length, 0);
  if (row.n !== legacySales.length || items !== memItems || row.t !== memSum) {
    throw new Error(`[migrate] golden-dump mismatch: db(n=${row.n},t=${row.t},items=${items}) vs dump(n=${legacySales.length},t=${memSum},items=${memItems})`);
  }
}
b.close();
console.log(JSON.stringify({ out, stats }, null, 2));
