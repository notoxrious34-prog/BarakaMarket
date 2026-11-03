import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from './sqlite.js';
import { calculateSaleTotalsCt } from '../core/fiscal.centimes.js';

const TMP = path.resolve('data/.tmp-tests/backups');
const tmpDb = (name: string): string => {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, name);
  try { fs.unlinkSync(p); } catch { /* fresh */ }
  try { fs.unlinkSync(`${p}-wal`); } catch { /* fresh */ }
  try { fs.unlinkSync(`${p}-shm`); } catch { /* fresh */ }
  return p;
};

const PROD = (id: number, barcode: string) => ({
  id, barcode, name_fr: `PROD ${id}`, name_ar: '', category_id: 'test',
  buy_price_ct: 1000, sell_price_ct: 1500, tva_rate: 0 as const, stock_milli: 1000,
  min_stock_milli: 0, unit: 'PIECE' as const, is_scale: 0, scale_item_code: null,
  has_expiry: 0, expiry_date: null,
});

test('backup: hot snapshot file with SHA-256 and VERIFIED log row', () => {
  const dbPath = tmpDb('hot.db');
  const b = openBarakaDb(dbPath);
  b.upsertProduct(PROD(40, '6130000000405'));
  const meta = b.createDatabaseBackup({ destinationDir: TMP, label: 'test' });
  assert.match(meta.filename, /^baraka-backup-\d{8}-\d{6}-test\.sqlite$/);
  assert.ok(fs.existsSync(meta.filePath));
  assert.match(meta.sha256Checksum, /^[0-9a-f]{64}$/);
  assert.ok(meta.fileSizeBytes > 0);
  assert.equal(meta.productsCount, 1);
  assert.equal(meta.status, 'VERIFIED');
  b.close();
  fs.rmSync(meta.filePath);
});

test('backup: snapshot passes integrity and mirrors live counts', () => {
  const dbPath = tmpDb('mirror.db');
  const b = openBarakaDb(dbPath);
  b.upsertProduct(PROD(41, '6130000000412'));
  const meta = b.createDatabaseBackup({ destinationDir: TMP });
  const rep = b.validateBackupForRestore(meta.filePath);
  assert.equal(rep.isValid, true);
  assert.deepEqual(rep.errors, []);
  assert.equal(rep.integrityCheckResult, 'ok');
  assert.equal(rep.sha256, meta.sha256Checksum);
  assert.ok(rep.tableCount > 10);
  // DB keeps serving reads and writes around the hot backup.
  b.upsertProduct(PROD(42, '6130000000429'));
  assert.equal(b.getProduct(42).name_fr, 'PROD 42');
  b.close();
  fs.rmSync(meta.filePath);
});

test('backup: garbage and truncated files fail pre-flight', () => {
  const b = openBarakaDb(':memory:');
  const garbage = path.join(TMP, 'garbage.sqlite');
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(garbage, 'this is definitely not a sqlite database file');
  const bad = b.validateBackupForRestore(garbage);
  assert.equal(bad.isValid, false);
  assert.ok(bad.errors.some(e => e.includes('magic')));
  const missing = b.validateBackupForRestore(path.join(TMP, 'nope.sqlite'));
  assert.equal(missing.isValid, false);
  assert.ok(missing.errors.some(e => e.includes('does not exist')));
  b.close();
  fs.rmSync(garbage);
});

test('backup: truncated snapshot fails integrity open', () => {
  const dbPath = tmpDb('trunc.db');
  const b = openBarakaDb(dbPath);
  b.upsertProduct(PROD(43, '6130000000436'));
  const meta = b.createDatabaseBackup({ destinationDir: TMP });
  const trunc = path.join(TMP, 'trunc.sqlite');
  fs.writeFileSync(trunc, fs.readFileSync(meta.filePath).subarray(0, 200));
  const rep = b.validateBackupForRestore(trunc);
  assert.equal(rep.isValid, false);
  b.close();
  fs.rmSync(meta.filePath);
  fs.rmSync(trunc);
});

test('backup: restore drill quarantines first, then rewinds state', () => {
  const dbPath = tmpDb('restore.db');
  const b = openBarakaDb(dbPath);
  b.upsertProduct(PROD(44, '6130000000443'));
  const meta = b.createDatabaseBackup({ destinationDir: TMP });
  b.upsertProduct(PROD(45, '6130000000450'));
  const out = b.restoreBackupSafely(meta.filePath);
  assert.equal(out.success, true);
  assert.ok(fs.existsSync(out.quarantineBackupPath));
  assert.ok(out.quarantineBackupPath.includes('pre-restore-quarantine-'));
  assert.equal(out.restoredBackupPath, path.resolve(dbPath));
  const fresh = openBarakaDb(dbPath);
  assert.equal(fresh.getProduct(44).name_fr, 'PROD 44');
  assert.throws(() => fresh.getProduct(45), /not found/);
  const listed = fresh.listDatabaseBackups();
  assert.equal(listed[0].status, 'RESTORED');
  fresh.close();
  fs.rmSync(out.quarantineBackupPath);
  fs.rmSync(meta.filePath);
});

test('backup: invalid restore target aborts, live DB untouched', () => {
  const dbPath = tmpDb('norestore.db');
  const b = openBarakaDb(dbPath);
  b.upsertProduct(PROD(46, '6130000000467'));
  assert.throws(() => b.restoreBackupSafely(path.join(TMP, 'ghost.sqlite')), /BACKUP_INTEGRITY_FAILED/);
  assert.equal(b.getProduct(46).name_fr, 'PROD 46');
  assert.throws(() => openBarakaDb(':memory:').restoreBackupSafely(dbPath), /:memory:/);
  b.close();
});

test('backup §11: sale → backup → void → restore → identical journal', () => {
  // Shop-ready definition: the journal after restore is EXACTLY the journal
  // at backup time — same invoice, same active count, void gone.
  const dbPath = tmpDb('shopready.db');
  const b = openBarakaDb(dbPath);
  b.upsertProduct(PROD(47, '6130000000474'));
  const line = {
    product_id: 47, barcode: '6130000000474', name_fr: 'PROD 47', name_ar: '',
    unit_price_ct: 1500, qty_milli: 1000, unit: 'PIECE' as const, tva_rate: 0 as const,
    discount_bp: 0, line_ht_ct: 1500, line_tva_ct: 0, line_ttc_ct: 1500,
  };
  const totals = calculateSaleTotalsCt(
    [{ tva_rate: 0 as const, total_line_ht_ct: 1500, total_line_tva_ct: 0, total_line_ttc_ct: 1500 }],
    'ESPECES',
  );
  const hdr = {
    cashier_id: 'U-1', cashier_name: 'Shop', payment_method: 'ESPECES' as const,
    amount_paid_ct: 1500, amount_returned_ct: 0, totals, created_at: '2026-11-01T12:00:00.000Z',
  };
  const kept = b.recordSale({ ...hdr, client_sale_id: 'SHOP-1' }, [line]);
  const meta = b.createDatabaseBackup({ destinationDir: TMP, label: 'shopready' });
  const doomed = b.recordSale({ ...hdr, client_sale_id: 'SHOP-2' }, [line]);
  b.voidSale(doomed.id, 'post-backup void', 'Shop');
  assert.equal(b.activeSalesCount(), 1);
  const out = b.restoreBackupSafely(meta.filePath);
  assert.equal(out.success, true);
  const fresh = openBarakaDb(dbPath);
  assert.equal(fresh.activeSalesCount(), 1);
  const rows = fresh.db.prepare('SELECT invoice_number AS n FROM sales').all() as { n: string }[];
  assert.deepEqual(rows.map(r => r.n), [kept.invoice_number]);
  fresh.close();
  fs.rmSync(out.quarantineBackupPath);
  fs.rmSync(meta.filePath);
});

test('backup: catalog lists newest-first, tampered files flagged CORRUPT', () => {
  const dbPath = tmpDb('catalog.db');
  const b = openBarakaDb(dbPath);
  const first = b.createDatabaseBackup({ destinationDir: TMP, label: 'a' });
  const second = b.createDatabaseBackup({ destinationDir: TMP, label: 'b' });
  const listed = b.listDatabaseBackups();
  assert.equal(listed.length, 2);
  assert.equal(listed[0].filename, second.filename);
  fs.appendFileSync(second.filePath, 'tamper');
  const relisted = b.listDatabaseBackups();
  assert.equal(relisted.length, 1);
  assert.equal(relisted[0].filename, first.filename);
  b.close();
  fs.rmSync(first.filePath);
  fs.rmSync(second.filePath);
});

test('backup-pro: manifest sidecar written, shaped, and agreed by validate', async () => {
  const { checkManifestShape } = await import('../core/backup-catalog.js');
  const dbPath = tmpDb('manifest.db');
  const b = openBarakaDb(dbPath);
  b.upsertProduct(PROD(60, '6130000000603'));
  const meta = b.createDatabaseBackup({ destinationDir: TMP, label: 'pro' });
  assert.equal(meta.appVersion, '1.3.4');
  assert.equal(meta.schemaVersion, 7);
  assert.equal(meta.label, 'pro');
  const sidecar = `${meta.filePath}.manifest.json`;
  assert.ok(fs.existsSync(sidecar));
  const m = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(checkManifestShape(m), []);
  assert.equal(m['sha256'], meta.sha256Checksum);
  const rep = b.validateBackupForRestore(meta.filePath);
  assert.equal(rep.isValid, true);
  // Swapped bytes under a valid sidecar fail closed.
  fs.appendFileSync(meta.filePath, 'swap');
  const bad = b.validateBackupForRestore(meta.filePath);
  assert.equal(bad.isValid, false);
  b.close();
  fs.rmSync(meta.filePath, { force: true });
  fs.rmSync(sidecar, { force: true });
});

test('backup-pro: retention keeps newest 30, prunes files + sidecars + rows', () => {
  const dbPath = tmpDb('retention.db');
  const b = openBarakaDb(dbPath);
  const made: string[] = [];
  for (let i = 0; i < 33; i++) {
    made.push(b.createDatabaseBackup({ destinationDir: TMP, label: 'ret' }).filePath);
  }
  const listed = b.listDatabaseBackups();
  assert.equal(listed.length, 30);
  assert.equal(listed[0].filePath, made[32]);
  // The 3 oldest are gone from disk (db file and sidecar) and from the log.
  for (const gone of made.slice(0, 3)) {
    assert.equal(fs.existsSync(gone), false);
    assert.equal(fs.existsSync(`${gone}.manifest.json`), false);
  }
  for (const kept of made.slice(3)) {
    assert.equal(fs.existsSync(kept), true);
    assert.equal(fs.existsSync(`${kept}.manifest.json`), true);
  }
  b.close();
  for (const p of made.slice(3)) { fs.rmSync(p, { force: true }); fs.rmSync(`${p}.manifest.json`, { force: true }); }
});
