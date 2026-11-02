import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openBarakaDb } from './sqlite.js';

/**
 * #003 (Phase A): one-shot localStorage -> SQLite migration, golden-dump equality.
 * The golden fixture carries two COMPLETED sales (cash+timbre, card) with
 * deliberately NON-sequential numbers (FACT-...-000007 / ...-000003,
 * T-...-000041 / ...-000009). The migration must preserve numbers, reseed
 * seq to the maxima (FACT 7 / T 41), refuse a second run without --force,
 * and rebuild deterministically with --force.
 */
const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SCRIPT = path.join(ROOT, 'scripts', 'migrate-localstorage.ts');
const FIXTURE = path.join(ROOT, 'scripts', '__fixtures__', 'localstorage-golden.json');

const runMigrate = (outDb: string, extra: string[] = []) => {
  const r = spawnSync(process.execPath, [TSX_CLI, SCRIPT, FIXTURE, outDb, ...extra], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout as string, stderr: (r.stderr as string) || (r.error ? String(r.error) : '') };
};

const readDump = (outDb: string) => {
  const b = openBarakaDb(outDb);
  try {
    const sales = b.db.prepare(
      'SELECT id, invoice_number, ticket_number, total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct, status FROM sales ORDER BY created_at',
    ).all() as Array<Record<string, unknown>>;
    const items = (b.db.prepare('SELECT COUNT(*) AS n FROM sale_items').get() as { n: number }).n;
    const sum = (b.db.prepare('SELECT COALESCE(SUM(total_ttc_ct),0) AS t FROM sales').get() as { t: number }).t;
    const seq = (b.db.prepare('SELECT kind, last_n AS n FROM seq WHERE year = 2026').all() as Array<{ kind: string; n: number }>);
    return { sales, items, sum, seq };
  } finally {
    b.close();
  }
};

describe('#003 one-shot migration (golden dump)', () => {
  it('migrates with golden-dump equality, preserves numbers, reseeds seq', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baraka-mig-'));
    const outDb = path.join(dir, 'golden.db');
    try {
      const r = runMigrate(outDb);
      assert.equal(r.status, 0, `migrate failed: ${r.stderr}`);
      const stats = JSON.parse(r.stdout) as { stats: Record<string, number> };
      assert.equal(stats.stats.sales, 2);
      assert.equal(stats.stats.sale_items, 5);
      assert.equal(stats.stats.seq_reseeded, 2);

      const got = readDump(outDb);
      assert.equal(got.items, 5);
      assert.equal(got.sum, 279400); // 179400 (cash+timbre) + 100000 (card)
      assert.deepEqual(got.sales.map(s => s.invoice_number), ['FACT-2026-000007', 'FACT-2026-000003']);
      assert.deepEqual(got.sales.map(s => s.ticket_number), ['T-2026-000041', 'T-2026-000009']);
      assert.deepEqual(got.sales.map(s => s.status), ['COMPLETED', 'COMPLETED']);
      const seqMap = new Map(got.seq.map(s => [s.kind, s.n]));
      assert.equal(seqMap.get('FACT'), 7);
      assert.equal(seqMap.get('T'), 41);

      // Single lane continues: the next minted numbers follow the maxima.
      const b = openBarakaDb(outDb);
      try {
        assert.equal(b.nextInvoiceNumber(2026), 'FACT-2026-000008');
        assert.equal(b.nextTicketNumber(2026), 'T-2026-000042');
      } finally {
        b.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a second run without --force, rebuilds deterministically with --force', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baraka-mig-'));
    const outDb = path.join(dir, 'golden.db');
    try {
      assert.equal(runMigrate(outDb).status, 0);
      const second = runMigrate(outDb);
      assert.equal(second.status, 2);
      assert.match(second.stderr, /REFUSED/);
      assert.equal(readDump(outDb).sum, 279400); // untouched

      const forced = runMigrate(outDb, ['--force']);
      assert.equal(forced.status, 0, `force rebuild failed: ${forced.stderr}`);
      const got = readDump(outDb);
      assert.equal(got.sum, 279400);
      assert.equal(got.items, 5);
      const seqMap = new Map(got.seq.map(s => [s.kind, s.n]));
      assert.equal(seqMap.get('FACT'), 7);
      assert.equal(seqMap.get('T'), 41);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
