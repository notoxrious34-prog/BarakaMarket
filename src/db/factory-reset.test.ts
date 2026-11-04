import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from './sqlite.js';

const TMP = path.resolve('data/.tmp-tests/reset');
const tmpDb = (name: string): string => {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, name);
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(p + s); } catch { /* fresh */ } }
  return p;
};

const seedTrial = (dbPath: string) => {
  const b = openBarakaDb(dbPath);
  b.db.prepare(
    `INSERT INTO sales (id, invoice_number, ticket_number, total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct, payment_method, created_at)
     VALUES ('TRIAL-1','FACT-2026-000001','T-2026-000001',10000,900,0,10900,'ESPECES','2026-11-04T10:00:00.000Z')`,
  ).run();
  b.db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, qty_milli, unit, tva_rate, unit_price_ct, line_ht_ct, line_tva_ct, line_ttc_ct)
     VALUES ('TRIAL-1', NULL, 1000, 'PIECE', 9, 10000, 10000, 900, 10900)`,
  ).run();
  b.db.prepare(`INSERT INTO seq (kind, year, last_n) VALUES ('FACT', 2026, 1)`).run();
  b.db.prepare(
    `INSERT INTO audit_log (ts, actor, action, detail) VALUES ('2026-11-04T10:00:00.000Z','owner','sale.commit','trial')`,
  ).run();
  return b;
};

test('reset: refuses without a VERIFIED exempt archive', () => {
  const p = tmpDb('refuse-none.db');
  const b = openBarakaDb(p);
  assert.throws(() => b.factoryReset('nope.sqlite', 'owner'), /no VERIFIED exempt/);
  b.close();
});

test('reset: refuses when the only snapshot is non-exempt', () => {
  const p = tmpDb('refuse-plain.db');
  const b = openBarakaDb(p);
  const m = b.createDatabaseBackup({ destinationDir: TMP, label: 'plain' });
  assert.throws(() => b.factoryReset(m.filePath, 'owner'), /no VERIFIED exempt/);
  b.close();
  fs.rmSync(m.filePath, { force: true });
  fs.rmSync(`${m.filePath}.manifest.json`, { force: true });
});

test('reset: refuses a tampered archive (checksum mismatch)', () => {
  const p = tmpDb('refuse-tamper.db');
  const b = openBarakaDb(p);
  const m = b.createDatabaseBackup({ destinationDir: TMP, label: 'pre-reset', exempt: true });
  fs.appendFileSync(m.filePath, 'tamper');
  assert.throws(() => b.factoryReset(m.filePath, 'owner'), /checksum mismatch/);
  b.close();
  fs.rmSync(m.filePath, { force: true });
  fs.rmSync(`${m.filePath}.manifest.json`, { force: true });
});

test('reset: wipes trial books, restarts numbering, keeps one genesis audit row', () => {
  const p = tmpDb('clean.db');
  const b = seedTrial(p);
  const m = b.createDatabaseBackup({ destinationDir: TMP, label: 'pre-reset', exempt: true });
  const out = b.factoryReset(m.filePath, 'owner');
  assert.equal(out.archive, m.filePath);
  assert.equal(out.cleared['sales'], 1);
  assert.equal(out.cleared['sale_items'], 1);
  const n = (t: string) => (b.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  assert.equal(n('sales'), 0);
  assert.equal(n('sale_items'), 0);
  assert.equal(n('seq'), 0);
  // Audit restarts with exactly the genesis row citing the archive.
  const rows = b.db.prepare('SELECT action, detail FROM audit_log ORDER BY rowid').all() as { action: string; detail: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'factory_reset');
  assert.ok(rows[0].detail.includes('pre-reset') || rows[0].detail.includes(m.filename) || rows[0].detail.includes('archive'));
  // Append-only guards are back: fresh inserts are protected again.
  b.db.prepare(
    `INSERT INTO sales (id, invoice_number, ticket_number, total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct, payment_method, created_at)
     VALUES ('NEW-1','FACT-2026-000001','T-2026-000001',100,9,0,109,'ESPECES','2026-11-05T00:00:00.000Z')`,
  ).run();
  assert.throws(() => b.db.prepare(`DELETE FROM sales WHERE id = 'NEW-1'`).run(), /append-only/);
  // Numbering restarts at 000001 (owner-ordered commercial restart).
  assert.equal(b.nextInvoiceNumber(2026), 'FACT-2026-000001');
  b.close();
  fs.rmSync(m.filePath, { force: true });
  fs.rmSync(`${m.filePath}.manifest.json`, { force: true });
});
