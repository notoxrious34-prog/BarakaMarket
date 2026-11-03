import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backupFilename, manifestPathFor, buildManifest, checkManifestShape,
  prunePlan, backupAgeLabel,
} from './backup-catalog.js';

test('backup-catalog: filename is timestamped, label sanitized', () => {
  assert.equal(backupFilename(new Date('2026-11-03T10:05:07')), 'baraka-backup-20261103-100507.sqlite');
  assert.equal(backupFilename(new Date('2026-11-03T10:05:07'), 'avant-inventaire!'), 'baraka-backup-20261103-100507-avant-inventaire.sqlite');
  assert.equal(backupFilename(new Date('2026-11-03T10:05:07'), 'x', 2), 'baraka-backup-20261103-100507-x-2.sqlite');
  assert.equal(manifestPathFor('/d/b.sqlite'), '/d/b.sqlite.manifest.json');
});

test('backup-catalog: manifest shape accepts good, rejects tampered', () => {
  const m = buildManifest({
    app_version: '1.3.4', schema_version: 7, label: 'manual-ui',
    created_at: '2026-11-03T10:00:00.000Z', filename: 'baraka-backup-20261103-100000.sqlite',
    sha256: 'a'.repeat(64), size_bytes: 12345, sales_count: 3, products_count: 14,
  });
  assert.deepEqual(checkManifestShape(m), []);
  assert.deepEqual(checkManifestShape({ ...m, sha256: 'zz' }), ['bad sha256']);
  assert.deepEqual(checkManifestShape({ ...m, app: 'other' }), ['bad app tag']);
  assert.deepEqual(checkManifestShape({ ...m, size_bytes: 0 }), ['bad size_bytes']);
  assert.ok(checkManifestShape(null).length > 0);
});

test('backup-catalog: prune keeps N newest, rejects keep<1', () => {
  const rows = [
    { id: 'c', filename: 'c', created_at: '2026-11-03T03:00:00Z' },
    { id: 'b', filename: 'b', created_at: '2026-11-02T03:00:00Z' },
    { id: 'a', filename: 'a', created_at: '2026-11-01T03:00:00Z' },
  ];
  assert.deepEqual(prunePlan(rows, 2).map(r => r.id), ['a']);
  assert.deepEqual(prunePlan(rows, 5), []);
  assert.throws(() => prunePlan(rows, 0), /retention/);
});

test('backup-catalog: age label FR/AR', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.equal(backupAgeLabel('2026-11-03T11:59:30Z', now, false), "à l'instant");
  assert.equal(backupAgeLabel('2026-11-03T11:30:00Z', now, false), 'il y a 30 min');
  assert.equal(backupAgeLabel('2026-11-03T09:00:00Z', now, false), 'il y a 3 h');
  assert.equal(backupAgeLabel('2026-10-30T12:00:00Z', now, true), 'منذ 4 يوم');
});

test('backup-catalog: stableStringify is key-order invariant and JSON-compatible', async () => {
  const { stableStringify } = await import('./backup-catalog.js');
  const a = { z: 1, a: { d: [1, { y: 2, x: 1 }], c: 3 }, m: 'x' };
  const b = { m: 'x', a: { c: 3, d: [1, { x: 1, y: 2 }] }, z: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
  assert.deepEqual(JSON.parse(stableStringify(a)), JSON.parse(JSON.stringify(a)));
  assert.equal(stableStringify({ u: undefined, n: null, f: () => 0, k: 1 }), '{"k":1,"n":null}');
  assert.equal(stableStringify([1, undefined, 2]), '[1,null,2]');
  assert.equal(stableStringify('héllo'), '"héllo"');
});
