/**
 * Baraka Activation Desk station v4 — HTTP contract + hardening tests.
 * Fully isolated: DESK_DATA_DIR points at a scratch dir, so signing tests
 * never touch the real ledger. Success-path tests need a private key: they
 * reuse the repo's `.baraka-privkey.pem` when present, otherwise they SKIP
 * (contract-only mode) — never fail on a fresh clone without the key.
 *
 * NOTE (repo convention): top-level `test()` calls are NOT awaited — the
 * module must register every test synchronously so file-scope `test.after`
 * fires once at the end. Awaiting a test suspends module evaluation and
 * the after-hook (server.close) fires after the first test, killing the
 * shared listener for the rest (ECONNREFUSED on Node 26 + tsx).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDeskApp, DESK_TOKEN_HEADER } from './desk.js';
import { DESK_VERSION } from '../src/core/activation-desk.js';
import { LICENSE_PRICE_DZD } from '../src/core/licensing.js';

// ── Isolation: scratch data dir (ledger/token/audit/backup) ──
const SCRATCH = path.join(os.tmpdir(), `baraka-desk-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.env.DESK_DATA_DIR = SCRATCH;

// ── Signing key: reuse the repo PEM when present (isolated ledger) ──
if (!process.env.BARAKA_PRIVATE_KEY) {
  const pem = path.resolve(process.cwd(), '.baraka-privkey.pem');
  if (fs.existsSync(pem)) process.env.BARAKA_PRIVATE_KEY = fs.readFileSync(pem, 'utf8');
}
const HAS_KEY = !!process.env.BARAKA_PRIVATE_KEY;

const app = createDeskApp();
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => new Promise<void>((r, e) => {
  server.close(err => {
    try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* tmp hygiene */ }
    if (err) e(err); else r();
  });
}));

const TOKEN = fs.readFileSync(path.join(SCRATCH, '.desk-token'), 'utf8').trim();
assert.match(TOKEN, /^[0-9a-f]{64}$/);

const post = (p: string, body: unknown, token: string | null = TOKEN) =>
  fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { [DESK_TOKEN_HEADER]: token } : {}) },
    body: JSON.stringify(body),
  });

test('health exposes version + key/ledger status', async () => {
  const r = await fetch(`${base}/api/desk/health`);
  assert.equal(r.status, 200);
  const h = (await r.json()) as { ok: boolean; version: string; keyLoaded: boolean; ledgerCount: number; ledgerBrokenAt: number | null };
  assert.equal(h.ok, true);
  assert.equal(h.version, DESK_VERSION);
  assert.equal(typeof h.keyLoaded, 'boolean');
  assert.ok(Number.isInteger(h.ledgerCount) && h.ledgerCount >= 0);
});

test('hwid returns a canonical BM fingerprint', async () => {
  const h = (await (await fetch(`${base}/api/desk/hwid`)).json()) as { hwid: string };
  assert.match(h.hwid, /^BM-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
});

test('generate rejects bad input without touching crypto', async () => {
  const noStore = await post('/api/desk/generate', { store: '  ', hwid: 'BM-1111-2222-3333-4444' });
  assert.equal(noStore.status, 400);
  const badHwid = await post('/api/desk/generate', { store: 'Nour', hwid: 'not-a-hwid' });
  assert.equal(badHwid.status, 400);
});

test('verify: bogus key is INVALID (never throws)', async () => {
  const r = await post('/api/desk/verify', { store: 'Nour', hwid: 'BM-1111-2222-3333-4444', key: 'AK-bogus' });
  assert.equal(r.status, 200);
  const v = (await r.json()) as { valid: boolean; hwid: string | null };
  assert.equal(v.valid, false);
  assert.equal(v.hwid, 'BM-1111-2222-3333-4444');
});

test('verify accepts dash-less lowercase HWID (canonicalized)', async () => {
  const r = await post('/api/desk/verify', { store: 'Nour', hwid: 'bm1111222233334444', key: 'AK-bogus' });
  const v = (await r.json()) as { valid: boolean; hwid: string | null };
  assert.equal(v.valid, false);
  assert.equal(v.hwid, 'BM-1111-2222-3333-4444');
});

test('ledger + stats are consistent', async () => {
  const l = (await (await fetch(`${base}/api/desk/ledger?last=5`)).json()) as {
    entries: Array<{ seq: number }>; count: number; brokenAt: number | null;
  };
  assert.ok(Array.isArray(l.entries) && Number.isInteger(l.count));
  const s = (await (await fetch(`${base}/api/desk/stats`)).json()) as {
    issued: number; revoked: number; revenueDzd: number; count: number;
  };
  assert.equal(s.count, l.count);
  assert.equal(s.revenueDzd, s.issued * LICENSE_PRICE_DZD);
  assert.ok(s.issued >= s.revoked);
});

test('revoke of an unknown seq is 404', async () => {
  const r = await post('/api/desk/ledger/revoke', { seq: 999999999 });
  assert.equal(r.status, 404);
});

test('POSTs without the operator token are 401', async () => {
  for (const [p, body] of [
    ['/api/desk/generate', { store: 'X', hwid: 'BM-1111-2222-3333-4444' }],
    ['/api/desk/verify', { store: 'X', hwid: 'BM-1111-2222-3333-4444', key: 'AK-x' }],
    ['/api/desk/ledger/revoke', { seq: 1 }],
    ['/api/desk/ledger/check', { text: 'x' }],
  ] as Array<[string, unknown]>) {
    const r = await post(p, body, null);
    assert.equal(r.status, 401, p);
  }
  const wrong = await post('/api/desk/verify', { store: 'X', hwid: 'BM-1111-2222-3333-4444', key: 'AK-x' }, '0'.repeat(64));
  assert.equal(wrong.status, 401);
});

test('health carries backup + price + perm fields', async () => {
  const h = (await (await fetch(`${base}/api/desk/health`)).json()) as {
    backupCount: number; priceDzd: number; keyPermWarn: string | null;
  };
  assert.ok(Number.isInteger(h.backupCount) && h.backupCount >= 0);
  assert.equal(h.priceDzd, LICENSE_PRICE_DZD);
  assert.ok(h.keyPermWarn === null || typeof h.keyPermWarn === 'string');
});

// ── Success path (needs the private key; SKIPS cleanly without it) ──
type GenBody = { store: string; hwid: string; key: string; seq: number; ts: string; priceDzd: number; meta: { phone?: string; wilaya?: string; paidDzd?: number } | null };

test('generate issues a self-verified key with meta', { skip: !HAS_KEY }, async () => {
  const r = await post('/api/desk/generate', {
    store: 'Meta Shop', hwid: 'BM-AAAA-BBBB-CCCC-DDDD',
    meta: { phone: '0550123456', wilaya: 'Sétif', paidDzd: 5000, note: 'test' },
  });
  assert.equal(r.status, 200);
  const g = (await r.json()) as GenBody;
  assert.match(g.key, /^AK-[A-Za-z0-9_-]{86}$/);
  assert.equal(g.meta?.phone, '0550123456');
  assert.equal(g.meta?.wilaya, 'Sétif');
  assert.equal(g.meta?.paidDzd, 5000);
  // The issued key verifies through the public path.
  const v = await post('/api/desk/verify', { store: 'meta shop', hwid: g.hwid, key: g.key });
  assert.equal(((await v.json()) as { valid: boolean }).valid, true);
});

test('duplicate guard: 409 then force override', { skip: !HAS_KEY }, async () => {
  const hw = 'BM-1111-2222-3333-AAAA';
  const first = await post('/api/desk/generate', { store: 'Dup Shop', hwid: hw });
  assert.equal(first.status, 200);
  const seq1 = ((await first.json()) as GenBody).seq;
  const dup = await post('/api/desk/generate', { store: 'dup shop', hwid: hw.replace(/-/g, '').toLowerCase() });
  assert.equal(dup.status, 409);
  assert.equal(((await dup.json()) as { existingSeq: number }).existingSeq, seq1);
  const forced = await post('/api/desk/generate', { store: 'Dup Shop', hwid: hw, force: true });
  assert.equal(forced.status, 200);
  assert.ok(((await forced.json()) as GenBody).seq > seq1);
});

test('concurrent generates keep the chain intact (mutex)', { skip: !HAS_KEY }, async () => {
  const before = (await (await fetch(`${base}/api/desk/ledger?last=1`)).json()) as { count: number };
  const jobs = [1, 2, 3, 4, 5].map(i =>
    post('/api/desk/generate', { store: `Mutex Shop ${i}`, hwid: `BM-AAAA-100${i}-BBBB-CCCC` }),
  );
  const resps = await Promise.all(jobs);
  for (const r of resps) assert.equal(r.status, 200);
  const seqs = await Promise.all(resps.map(async r => ((await r.json()) as GenBody).seq));
  assert.equal(new Set(seqs).size, 5, 'every concurrent issue gets a distinct seq');
  const after = (await (await fetch(`${base}/api/desk/ledger?last=50`)).json()) as {
    count: number; brokenAt: number | null;
  };
  assert.equal(after.count, before.count + 5);
  assert.equal(after.brokenAt, null);
  const bk = (await (await fetch(`${base}/api/desk/health`)).json()) as { backupCount: number; ledgerCount: number };
  assert.equal(bk.backupCount, bk.ledgerCount);
});

test('revoke marks revokes + double revoke is 409', { skip: !HAS_KEY }, async () => {
  const g = await post('/api/desk/generate', { store: 'Revoke Shop', hwid: 'BM-EEEE-FFFF-0000-1111' });
  assert.equal(g.status, 200);
  const seq = ((await g.json()) as GenBody).seq;
  const r1 = await post('/api/desk/ledger/revoke', { seq });
  assert.equal(r1.status, 200);
  assert.equal(((await r1.json()) as { marker: { revokes: number } }).marker.revokes, seq);
  const r2 = await post('/api/desk/ledger/revoke', { seq });
  assert.equal(r2.status, 409);
  // A revoked pair can be issued again (replacement path).
  const g2 = await post('/api/desk/generate', { store: 'Revoke Shop', hwid: 'BM-EEEE-FFFF-0000-1111' });
  assert.equal(g2.status, 200);
});

test('audit trail records mutations + verifies', { skip: !HAS_KEY }, async () => {
  await post('/api/desk/verify', { store: 'Revoke Shop', hwid: 'BM-EEEE-FFFF-0000-1111', key: 'AK-bogus' });
  const a = (await (await fetch(`${base}/api/desk/audit?last=50`)).json()) as {
    entries: Array<{ action: string; ok: boolean; store?: string }>; count: number;
  };
  assert.ok(a.count >= 3);
  const kinds = new Set(a.entries.map(e => `${e.action}:${e.ok}`));
  assert.ok(kinds.has('generate:true'));
  assert.ok(kinds.has('verify:false'));
  assert.ok(kinds.has('revoke:true'));
});

test('ledger/check verifies an uploaded chain + rejects garbage', { skip: !HAS_KEY }, async () => {
  const live = await (await fetch(`${base}/api/desk/ledger?last=500`)).json() as {
    entries: Array<Record<string, unknown>>;
  };
  const text = live.entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  const ok = await post('/api/desk/ledger/check', { text });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { brokenAt: number | null }).brokenAt, null);
  const bad = await post('/api/desk/ledger/check', { text: 'not json\n' });
  assert.equal(bad.status, 400);
  const tampered = text.replace(/"store":"/, '"store":"X');
  const t2 = await post('/api/desk/ledger/check', { text: tampered });
  assert.equal(t2.status, 200);
  assert.ok(((await t2.json()) as { brokenAt: number | null }).brokenAt !== null);
});
