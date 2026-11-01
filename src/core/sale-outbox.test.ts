import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadOutbox, enqueueOutbox, replayOutbox, mintSaleKey, OUTBOX_KEY, OUTBOX_CAP,
  type OutboxEntry, type StorageLike,
} from './sale-outbox.js';

// T1 slice B (ADR-022): offline outbox + idempotent auto-replay. Pure module,
// StorageLike-injected so tests never touch the real localStorage.
const fakeStore = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => { m.set(k, v); } };
};

const entry = (key: string, provisionalId = `SALE-${key}`): OutboxEntry => ({
  key, kind: 'sale', provisionalId, header: { client_sale_id: key }, items: [], enqueuedAt: '2026-11-01T00:00:00.000Z', attempts: 0,
});

test('outbox: mintSaleKey yields unique UUID-shaped keys', () => {
  const a = mintSaleKey(), b = mintSaleKey();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/);
});

test('outbox: enqueue + load roundtrip', () => {
  const s = fakeStore();
  assert.deepEqual(loadOutbox(s), []);
  enqueueOutbox(s, entry('K1'));
  enqueueOutbox(s, entry('K2'));
  assert.deepEqual(loadOutbox(s).map(e => e.key), ['K1', 'K2']);
});

test('outbox: corrupted JSON loads as empty, never throws', () => {
  const s = fakeStore();
  s.setItem(OUTBOX_KEY, '{broken');
  assert.deepEqual(loadOutbox(s), []);
});

test('outbox: cap is FIFO — oldest dropped past OUTBOX_CAP', () => {
  const s = fakeStore();
  for (let i = 0; i < OUTBOX_CAP + 5; i++) enqueueOutbox(s, entry(`K${i}`));
  const keys = loadOutbox(s).map(e => e.key);
  assert.equal(keys.length, OUTBOX_CAP);
  assert.ok(!keys.includes('K0'));
  assert.ok(keys.includes(`K${OUTBOX_CAP + 4}`));
});

test('outbox: replay success drains queue and returns receipts', async () => {
  const s = fakeStore();
  enqueueOutbox(s, entry('K1'));
  enqueueOutbox(s, entry('K2'));
  const post = async (e: OutboxEntry) => ({ id: 'srv-1', invoice_number: 'FACT-2026-000001', ticket_number: 'T-2026-000001', _key: (e.header as { client_sale_id: string }).client_sale_id });
  const { done, remaining } = await replayOutbox(s, post as never);
  assert.equal(done.length, 2);
  assert.equal(remaining.length, 0);
  assert.deepEqual(loadOutbox(s), []);
});

test('outbox: replay failure keeps entry with attempts+1, others drain', async () => {
  const s = fakeStore();
  enqueueOutbox(s, entry('GOOD'));
  enqueueOutbox(s, entry('BAD'));
  let calls = 0;
  const post = async (e: OutboxEntry) => {
    calls++;
    if ((e.header as { client_sale_id: string }).client_sale_id === 'BAD') return null;
    return { id: 'srv-9', invoice_number: 'FACT-2026-000009', ticket_number: 'T-2026-000009' };
  };
  const { done, remaining } = await replayOutbox(s, post as never);
  assert.equal(calls, 2);
  assert.equal(done.length, 1);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].key, 'BAD');
  assert.equal(remaining[0].attempts, 1);
  assert.deepEqual(loadOutbox(s).map(e => e.key), ['BAD']);
});

test('outbox: settlement kind replays by kind and carries receipt_number', async () => {
  const s = fakeStore();
  enqueueOutbox(s, { key: 'ST-1', kind: 'settlement', provisionalId: 'SETTLE-x', header: { client_settlement_key: 'ST-1' }, items: [], enqueuedAt: '2026-11-01T00:00:00.000Z', attempts: 0 });
  const post = async (e: OutboxEntry) => {
    assert.equal(e.kind, 'settlement');
    return { id: 'set-1', receipt_number: 'Q-2026-000001' };
  };
  const { done, remaining } = await replayOutbox(s, post as never);
  assert.equal(done.length, 1);
  assert.equal(done[0].kind, 'settlement');
  assert.equal(done[0].auth.receipt_number, 'Q-2026-000001');
  assert.equal(remaining.length, 0);
});

test('outbox: pre-kind (T1) entries load as sale kind', () => {
  const s = fakeStore();
  s.setItem(OUTBOX_KEY, JSON.stringify([{ key: 'OLD', provisionalId: 'SALE-OLD', header: {}, items: [], enqueuedAt: 'x', attempts: 0 }]));
  assert.equal(loadOutbox(s)[0].kind, 'sale');
});
