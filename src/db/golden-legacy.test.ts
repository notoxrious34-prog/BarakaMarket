/**
 * A2 (PLAN-v1.2.0): golden-legacy boot — the oldest shop file shape must open,
 * not crash. Regression guard for the `no such column: day` kill (idx_z_day
 * applied before the z_reports climb). RED first: openBarakaDb throws today.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openBarakaDb } from './sqlite.ts';

function craftLegacyShape(p: string): void {
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const db = new DatabaseSync(p);
  db.exec(`CREATE TABLE sales (id INTEGER PRIMARY KEY, invoice_number TEXT, total_ttc_ct INTEGER NOT NULL DEFAULT 0, status TEXT DEFAULT 'COMPLETED', created_at TEXT);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, line_ttc_ct INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE z_reports (id INTEGER PRIMARY KEY, total_ttc_ct INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE client_settlements (id INTEGER PRIMARY KEY, amount_ct INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE seq (kind TEXT NOT NULL, year INTEGER NOT NULL, last_n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (kind, year));
    PRAGMA user_version = 0;`);
  db.close();
}

describe('A2 golden-legacy boot', () => {
  it('opens the oldest shop shape: climbs to v6, indexes restored, owner seeded', () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'baraka-legacy-')), 'legacy.db');
    craftLegacyShape(p);
    const { db, close } = openBarakaDb(p); // must NOT throw
    try {
      const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      assert.equal(v, 6);
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_z_day'").get();
      assert.ok(idx, 'idx_z_day restored post-migration');
      const owner = db.prepare("SELECT username, must_change_pin FROM users WHERE username='owner'").get() as { username: string; must_change_pin: number } | undefined;
      assert.ok(owner, 'first owner seeded on legacy climb');
      assert.equal(owner!.must_change_pin, 1);
    } finally {
      close();
    }
  });
});
