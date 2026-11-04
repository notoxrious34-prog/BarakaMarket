import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectLocalSnapshotData, buildLocalSnapshot, restoreLocalSnapshot, restoreLocalSnapshotKeys,
  type SnapshotStore,
} from './local-snapshot.js';
import { APP_VERSION } from './version.js';

/** In-memory Storage double (node has no localStorage). */
function memStore(seed: Record<string, string> = {}): SnapshotStore & { dump: () => Record<string, string> } {
  const m = new Map(Object.entries(seed));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    dump: () => Object.fromEntries(m),
  };
}

test('local-snapshot: captures every baraka_ key (incl. seq counters), ignores foreign', () => {
  const s = memStore({
    baraka_products_v2: '[]',
    baraka_seq_FACT_2026: '42',
    baraka_held_carts_v2: '{}',
    other_app_key: 'x',
  });
  const data = collectLocalSnapshotData(s);
  assert.deepEqual(Object.keys(data).sort(), ['baraka_held_carts_v2', 'baraka_products_v2', 'baraka_seq_FACT_2026']);
  assert.equal(data['baraka_seq_FACT_2026'], 42);
});

test('local-snapshot: export → import round-trips incl. seq counters', async () => {
  const src = memStore({ baraka_seq_FACT_2026: '42', baraka_products_v2: '[{"id":1}]' });
  const text = await buildLocalSnapshot(src);
  const env = JSON.parse(text) as Record<string, unknown>;
  assert.equal(env['app'], 'baraka-market');
  assert.equal(env['app_version'], APP_VERSION);
  assert.match(String(env['sha256']), /^[0-9a-f]{64}$/);
  const dst = memStore();
  const res = await restoreLocalSnapshot(text, dst);
  assert.deepEqual(res.keys.sort(), ['baraka_products_v2', 'baraka_seq_FACT_2026']);
  assert.deepEqual(res.warnings, []);
  assert.equal(dst.dump()['baraka_seq_FACT_2026'], '42');
});

test('local-snapshot: tampered bytes fail closed; foreign keys never written', async () => {
  const src = memStore({ baraka_products_v2: '[]' });
  const env = JSON.parse(await buildLocalSnapshot(src)) as Record<string, any>;
  env['data']['baraka_products_v2'] = [{ id: 999 }];
  env['data']['evil'] = 'drop table';
  await assert.rejects(() => restoreLocalSnapshot(JSON.stringify(env), memStore()), /checksum mismatch/);
  await assert.rejects(() => restoreLocalSnapshot('garbage', memStore()), /not JSON/);
  await assert.rejects(() => restoreLocalSnapshot('{"app":"other"}', memStore()), /not a baraka snapshot/);
});

test('local-snapshot: version drift warns but restores', async () => {
  const src = memStore({ baraka_products_v2: '[]' });
  const env = JSON.parse(await buildLocalSnapshot(src)) as Record<string, any>;
  env['app_version'] = '0.0.0';
  const { createHash } = await import('node:crypto');
  const { stableStringify } = await import('./backup-catalog.js');
  env['sha256'] = createHash('sha256').update(stableStringify(env['data'])).digest('hex');
  const res = await restoreLocalSnapshot(JSON.stringify(env), memStore());
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /version drift/);
});

test('local-snapshot P3: selective restore writes only the allowed scope (suppliers), tamper still fails', async () => {
  const src = memStore({
    baraka_suppliers_v2: '[{"id":1}]',
    baraka_products_v2: '[{"id":9}]',
    baraka_clients_v2: '[{"id":3}]',
  });
  const text = await buildLocalSnapshot(src);
  const dst = memStore();
  const res = await restoreLocalSnapshotKeys(text, dst, ['baraka_suppliers_v2']);
  assert.deepEqual(res.keys, ['baraka_suppliers_v2']);
  assert.equal(dst.dump()['baraka_suppliers_v2'], '[{"id":1}]');
  assert.equal(dst.dump()['baraka_products_v2'], undefined);
  assert.equal(dst.dump()['baraka_clients_v2'], undefined);
  // Same tamper gate as full restore.
  const env = JSON.parse(text) as Record<string, any>;
  env['data']['baraka_suppliers_v2'] = [{ id: 666 }];
  await assert.rejects(() => restoreLocalSnapshotKeys(JSON.stringify(env), memStore(), ['baraka_suppliers_v2']), /checksum mismatch/);
  // Empty scope selection fails closed.
  await assert.rejects(() => restoreLocalSnapshotKeys(text, memStore(), []), /none of the selected keys/);
});
