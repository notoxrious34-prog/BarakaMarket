import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { openBarakaDb } from './sqlite.js';
import { enqueueOutbox, replayOutbox, type StorageLike } from '../core/sale-outbox.js';
import { calculateSaleTotalsCt } from '../core/fiscal.centimes.js';

/**
 * T7 (ADR-030) — power-cut drill with a REAL kill.
 * A child process opens the same WAL file, takes BEGIN IMMEDIATE, writes a
 * partial sale + bumps seq, then sleeps holding the lock (the crashed shop).
 * The parent proves: (1) uncommitted work is invisible, (2) the lock
 * conflict surfaces instead of silent corruption, (3) after SIGKILL the
 * next open recovers clean (no partial row, seq unconsumed), and (4) the
 * file-backed outbox replays exactly once across the "restart".
 *
 * NOTE: C: is 100% full -> everything lives under data/.tmp-tests (D:).
 */
const TMP = path.join(process.cwd(), 'data', '.tmp-tests');
fs.mkdirSync(TMP, { recursive: true });
let n = 0;
const tmpFile = (tag: string) => {
  n += 1;
  const p = path.join(TMP, `${tag}-${process.pid}-${n}.db`);
  for (const suf of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suf); } catch { /* fresh */ }
  }
  return p;
};
const cleanup = (p: string) => {
  for (const suf of ['', '-wal', '-shm', '-journal', '.ready']) {
    try { fs.unlinkSync(p + suf); } catch { /* ignore */ }
  }
};

const CRASH_CHILD = `
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const [dbPath, readyFile] = process.argv.slice(2);
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('BEGIN IMMEDIATE');
db.prepare("INSERT INTO sales (id, invoice_number, ticket_number, total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct, payment_method, created_at) VALUES ('CRASH-1','FACT-CRASH','T-CRASH',100,9,0,109,'ESPECES','2026-11-01T00:00:00.000Z')").run();
db.exec("INSERT INTO seq(kind,year,last_n) VALUES('FACT',2026,41) ON CONFLICT(kind,year) DO UPDATE SET last_n=41");
fs.writeFileSync(readyFile, 'ready');
setInterval(() => {}, 1000);
`;

const ADHOC = [
  { product_id: null, barcode: 'b', name_fr: 'HUILE', name_ar: '', unit_price_ct: 65000, qty_milli: 1000, unit: 'PIECE' as const, tva_rate: 0 as const, discount_bp: 0, line_ht_ct: 65000, line_tva_ct: 0, line_ttc_ct: 65000 },
];
const totals = () => calculateSaleTotalsCt(
  [{ tva_rate: 0 as const, total_line_ht_ct: 65000, total_line_tva_ct: 0, total_line_ttc_ct: 65000 }],
  'ESPECES',
);
const header = (extra: Record<string, unknown> = {}) => ({
  cashier_id: 'C-1', cashier_name: 'Amine',
  payment_method: 'ESPECES' as const, amount_paid_ct: 65000, amount_returned_ct: 0,
  totals: totals(), created_at: '2026-11-01T12:00:00.000Z', ...extra,
});
const salesCount = (b: ReturnType<typeof openBarakaDb>) =>
  (b.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;

const waitReady = (p: string, ms = 15000) => {
  const t0 = Date.now();
  while (!fs.existsSync(p)) {
    if (Date.now() - t0 > ms) throw new Error('crasher child never signalled ready');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
};
const killAndWait = (c: ChildProcess) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 5000);
    c.on('exit', () => { clearTimeout(t); resolve(); });
    c.kill();
  });

const fileStore = (p: string): StorageLike => ({
  getItem: (k) => {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
      return j[k] ?? null;
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    let j: Record<string, string> = {};
    try {
      j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
    } catch { /* fresh */ }
    j[k] = v;
    fs.writeFileSync(p, JSON.stringify(j));
  },
});

test('T7: kill -9 mid-commit leaves no partial row and seq unconsumed', async () => {
  const dbPath = tmpFile('powercut');
  const childPath = `${dbPath}.crasher.mjs`;
  const readyFile = `${dbPath}.ready`;
  fs.writeFileSync(childPath, CRASH_CHILD);
  try {
    // Fresh v3 file (migrations done BEFORE the crash, like a real shop).
    openBarakaDb(dbPath).db.close();

    const child = spawn(process.execPath, [childPath, dbPath, readyFile], { stdio: 'ignore' });
    waitReady(readyFile);

    // (1) Uncommitted work is invisible to a second connection.
    const b = openBarakaDb(dbPath);
    assert.equal(salesCount(b), 0);
    // (2) The crashed writer's lock surfaces as BUSY — never silent corruption.
    assert.throws(() => b.recordSale(header({ client_sale_id: 'DURING-CRASH' }), ADHOC), /BUSY|busy|locked/i);
    b.db.close();

    // (3) SIGKILL the crashed writer; next open recovers clean.
    await killAndWait(child);
    const c = openBarakaDb(dbPath);
    assert.equal(salesCount(c), 0);
    const seq = c.db.prepare("SELECT last_n AS n FROM seq WHERE kind='FACT' AND year=2026").get() as { n: number } | undefined;
    assert.ok(!seq || seq.n === 0, 'seq must be unconsumed after rollback');
    const first = c.recordSale(header({ client_sale_id: 'AFTER-CRASH' }), ADHOC);
    assert.equal(first.invoice_number, 'FACT-2026-000001');
    assert.equal(salesCount(c), 1);
    c.db.close();
  } finally {
    try { fs.unlinkSync(childPath); } catch { /* ignore */ }
    cleanup(dbPath);
  }
});

test('T7: file-backed outbox replays exactly once across the restart', async () => {
  const dbPath = tmpFile('powercut-outbox');
  const storePath = `${dbPath}.outbox.json`;
  try {
    const c = openBarakaDb(dbPath);
    // Crash BEFORE the POST: the queue (on disk) is the only survivor.
    let store = fileStore(storePath);
    enqueueOutbox(store, {
      key: 'CRASH-KEY', kind: 'sale', provisionalId: 'prov-1',
      header: header({ client_sale_id: 'CRASH-KEY' }), items: ADHOC,
      enqueuedAt: '2026-11-01T12:00:00.000Z', attempts: 0,
    });
    // "Restart": drop every in-memory ref, re-read the queue from disk.
    store = fileStore(storePath);
    const post = async (e: { header: unknown; items: unknown[] }) => {
      const r = c.recordSale(
        e.header as Parameters<typeof c.recordSale>[0],
        e.items as Parameters<typeof c.recordSale>[1],
      );
      return { id: r.id, invoice_number: r.invoice_number, ticket_number: r.ticket_number };
    };
    const once = await replayOutbox(store, post);
    assert.equal(once.done.length, 1);
    assert.equal(once.done[0].auth.invoice_number, 'FACT-2026-000001');
    assert.equal(salesCount(c), 1);
    assert.equal(once.remaining.length, 0);

    // Duplicate retry after an unclean shutdown still commits once (T1 key).
    enqueueOutbox(fileStore(storePath), {
      key: 'CRASH-KEY', kind: 'sale', provisionalId: 'prov-1',
      header: header({ client_sale_id: 'CRASH-KEY' }), items: ADHOC,
      enqueuedAt: '2026-11-01T12:00:01.000Z', attempts: 0,
    });
    const twice = await replayOutbox(fileStore(storePath), post);
    assert.equal(twice.done.length, 1);
    assert.equal(twice.done[0].auth.invoice_number, 'FACT-2026-000001');
    assert.equal(salesCount(c), 1);
    c.db.close();
  } finally {
    try { fs.unlinkSync(storePath); } catch { /* ignore */ }
    cleanup(dbPath);
  }
});
