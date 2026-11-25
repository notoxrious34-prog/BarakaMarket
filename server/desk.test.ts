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
import { createPrivateKey, sign } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createDeskApp, DESK_TOKEN_HEADER } from './desk.js';
import { DESK_VERSION } from '../src/core/activation-desk.js';
import { LICENSE_PRICE_DZD } from '../src/core/licensing.js';
import { envelopeFromInput, formatEnvelopeKey, buildEnvelopePayload } from '../src/core/license-envelope.js';
import { verifyUnlock } from '../src/core/license-unlock.js';

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
  const h = (await r.json()) as {
    ok: boolean; version: string; keyLoaded: boolean; ledgerCount: number; ledgerBrokenAt: number | null;
    auditCount: number; lastIssueTs: string | null;
  };
  assert.equal(h.ok, true);
  assert.equal(h.version, DESK_VERSION);
  assert.equal(typeof h.keyLoaded, 'boolean');
  assert.ok(Number.isInteger(h.ledgerCount) && h.ledgerCount >= 0);
  assert.ok(Number.isInteger(h.auditCount) && h.auditCount >= 0);
  assert.ok(h.lastIssueTs === null || typeof h.lastIssueTs === 'string');
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
    issued: number; revoked: number; revenueDzd: number; netIssued: number; netRevenueDzd: number; count: number;
  };
  assert.equal(s.count, l.count);
  assert.equal(s.revenueDzd, s.issued * LICENSE_PRICE_DZD);
  assert.equal(s.netRevenueDzd, s.netIssued * LICENSE_PRICE_DZD);
  assert.ok(s.issued >= s.revoked);
  assert.ok(s.netIssued <= s.issued);
});

test('net stats exclude replaced + duplicate pairs', { skip: !HAS_KEY }, async () => {
  const before = (await (await fetch(`${base}/api/desk/stats`)).json()) as { netIssued: number; issued: number };
  const g = await post('/api/desk/generate', { store: 'Net Shop', hwid: 'BM-6000-6000-6000-6001' });
  assert.equal(g.status, 200);
  const mid = (await (await fetch(`${base}/api/desk/stats`)).json()) as { netIssued: number; issued: number };
  assert.equal(mid.netIssued, before.netIssued + 1);
  // Force a duplicate: gross grows, net does not.
  await post('/api/desk/generate', { store: 'Net Shop', hwid: 'BM-6000-6000-6000-6001', force: true });
  const after = (await (await fetch(`${base}/api/desk/stats`)).json()) as { netIssued: number; issued: number };
  assert.equal(after.issued, mid.issued + 1);
  assert.equal(after.netIssued, mid.netIssued);
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
type V2Info = { tier: string; exp: number | null; maxVer: string | null; hwid2: string | null };
type GenBody = { store: string; hwid: string; key: string; seq: number; ts: string; priceDzd: number; format: 'v1' | 'v2'; v2: V2Info | null; meta: { phone?: string; wilaya?: string; paidDzd?: number } | null };

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

// ── P0: v2 envelope, unlock codes, atomic transfer ──
test('generate v2 issues a self-verified envelope (tier + spare HWID)', { skip: !HAS_KEY }, async () => {
  const r = await post('/api/desk/generate', {
    store: 'V2 Shop', hwid: 'BM-1111-2222-3333-0001', format: 'v2',
    v2: { tier: 'SUPPORT12', expires: '2099-01-01', maxVer: '1.10.0', hwid2: 'BM-1111-2222-3333-0002' },
  });
  assert.equal(r.status, 200);
  const g = (await r.json()) as GenBody;
  assert.equal(g.format, 'v2');
  assert.match(g.key, /^AK2-/);
  assert.equal(g.v2?.tier, 'SUPPORT12');
  assert.equal(g.v2?.maxVer, '1.10.0');
  assert.equal(g.v2?.hwid2, 'BM-1111-2222-3333-0002');
  const v = await post('/api/desk/verify', { store: 'v2 shop', hwid: g.hwid, key: g.key });
  const vv = (await v.json()) as { valid: boolean; format: string; tier: string; slot: number };
  assert.equal(vv.valid, true);
  assert.equal(vv.format, 'v2');
  assert.equal(vv.tier, 'SUPPORT12');
  assert.equal(vv.slot, 1);
  const v2 = await post('/api/desk/verify', { store: 'V2 SHOP', hwid: 'BM-1111-2222-3333-0002', key: g.key });
  const vv2 = (await v2.json()) as { valid: boolean; format: string; slot: number };
  assert.equal(vv2.valid, true);
  assert.equal(vv2.format, 'v2');
  assert.equal(vv2.slot, 2);
});

test('v2 rejects bad policy input with 400', { skip: !HAS_KEY }, async () => {
  const cases: Array<{ hwid: string; v2: Record<string, unknown> }> = [
    { hwid: 'BM-2222-3333-4444-5555', v2: { tier: 'GOLD' } },
    { hwid: 'BM-2222-3333-4444-5556', v2: { tier: 'PERP', expires: '2000-01-01' } },
    { hwid: 'BM-2222-3333-4444-5557', v2: { maxVer: 'soon' } },
    { hwid: 'BM-2222-3333-4444-5558', v2: { hwid2: 'BM-2222-3333-4444-5558' } },
    { hwid: 'BM-2222-3333-4444-5559', v2: { hwid2: 'not-a-hwid' } },
  ];
  for (const [i, c] of cases.entries()) {
    const r = await post('/api/desk/generate', { store: `V2 Bad ${i}`, hwid: c.hwid, format: 'v2', v2: c.v2 });
    assert.equal(r.status, 400, `case ${i}`);
  }
});

test('v2 duplicate guard: same pair refused with 409', { skip: !HAS_KEY }, async () => {
  const r = await post('/api/desk/generate', {
    store: 'V2 Shop', hwid: 'BM-1111-2222-3333-0001', format: 'v2', v2: { tier: 'PERP' },
  });
  assert.equal(r.status, 409);
  assert.ok(Number.isInteger(((await r.json()) as { existingSeq: number }).existingSeq));
});

test('verify reports expired v2 honestly (signed fixture)', { skip: !HAS_KEY }, async () => {
  const priv = createPrivateKey(process.env.BARAKA_PRIVATE_KEY as string);
  const past = Date.now() - 30 * 86400000;
  const env = envelopeFromInput('Old Shop', {
    tier: 'SUPPORT12', issuedMs: past - 86400000, expiresMs: past, hwid1: 'BM-9999-8888-7777-6666',
  })!;
  const key = formatEnvelopeKey(env, sign(null, Buffer.from(buildEnvelopePayload(env)), priv).toString('base64url'));
  const r = await post('/api/desk/verify', { store: 'OLD SHOP', hwid: 'BM-9999-8888-7777-6666', key });
  const v = (await r.json()) as { valid: boolean; format: string; expired: boolean; tier: string };
  assert.equal(v.valid, false);
  assert.equal(v.format, 'v2');
  assert.equal(v.expired, true);
  assert.equal(v.tier, 'SUPPORT12');
});

test('tampered v2 fails closed as v2 (no fallback, no crash)', { skip: !HAS_KEY }, async () => {
  const g = await post('/api/desk/generate', {
    store: 'V2 Tamper Shop', hwid: 'BM-1010-2020-3030-4040', format: 'v2', v2: { tier: 'PERP' },
  });
  assert.equal(g.status, 200);
  const key = ((await g.json()) as GenBody).key;
  const bad = key.slice(0, -2) + (key.endsWith('AA') ? 'BB' : 'AA');
  const r = await post('/api/desk/verify', { store: 'V2 Tamper Shop', hwid: 'BM-1010-2020-3030-4040', key: bad });
  const v = (await r.json()) as { valid: boolean; format: string };
  assert.equal(v.valid, false);
  assert.equal(v.format, 'v2');
});

test('unlock/issue mints a verifiable single-use code', { skip: !HAS_KEY }, async () => {
  const hwid = 'BM-5555-6666-7777-8888';
  const r = await post('/api/desk/unlock/issue', { hwid, scope: 'drift', days: 7, counter: 1 });
  assert.equal(r.status, 200);
  const u = (await r.json()) as { code: string; hwid: string; scope: string; counter: number; exp: number };
  assert.match(u.code, /^UL-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/);
  assert.equal(u.scope, 'drift');
  const now = Date.now();
  assert.equal((await verifyUnlock(u.code, hwid, 0, now)).ok, true);
  assert.equal((await verifyUnlock(u.code, hwid, 1, now)).reason, 'REPLAY');
  for (const bad of [
    { hwid, scope: 'nonsense', days: 7, counter: 1 },
    { hwid, scope: 'drift', days: 99, counter: 1 },
    { hwid: 'garbage', scope: 'drift', days: 7, counter: 1 },
  ]) {
    assert.equal((await post('/api/desk/unlock/issue', bad)).status, 400);
  }
});

test('transfer retires + reissues atomically (no two-active window)', { skip: !HAS_KEY }, async () => {
  const g = await post('/api/desk/generate', { store: 'Transfer Shop', hwid: 'BM-AAAA-0000-BBBB-1111' });
  assert.equal(g.status, 200);
  const seq1 = ((await g.json()) as GenBody).seq;
  const t = await post('/api/desk/transfer', { oldSeq: seq1, newHwid: 'BM-AAAA-0000-BBBB-2222' });
  assert.equal(t.status, 200);
  const tr = (await t.json()) as {
    store: string; oldSeq: number; revokeSeq: number; newHwid: string;
    issue: { key: string; seq: number }; format: string;
  };
  assert.equal(tr.store, 'TRANSFER SHOP');
  assert.equal(tr.oldSeq, seq1);
  assert.ok(tr.revokeSeq > seq1 && tr.issue.seq === tr.revokeSeq + 1);
  const tail = (await (await fetch(`${base}/api/desk/ledger?last=3`)).json()) as {
    entries: Array<{ seq: number; kind: string; hwid: string; revokes?: number }>; brokenAt: number | null;
  };
  assert.equal(tail.brokenAt, null);
  const last2 = tail.entries.slice(-2);
  assert.equal(last2[0].kind, 'revoke');
  assert.equal(last2[0].revokes, seq1);
  assert.equal(last2[1].kind, 'issue');
  assert.equal(last2[1].hwid, 'BM-AAAA-0000-BBBB-2222');
  // The old pair is retired: re-issuing it is a fresh 200, not a 409.
  const g2 = await post('/api/desk/generate', { store: 'Transfer Shop', hwid: 'BM-AAAA-0000-BBBB-1111' });
  assert.equal(g2.status, 200);
  // Re-transferring the same seq is refused.
  assert.equal((await post('/api/desk/transfer', { oldSeq: seq1, newHwid: 'BM-AAAA-0000-BBBB-3333' })).status, 409);
  // Unknown seq and identical HWID are refused.
  assert.equal((await post('/api/desk/transfer', { oldSeq: 999999999, newHwid: 'BM-AAAA-0000-BBBB-3333' })).status, 404);
  const g3 = await post('/api/desk/generate', { store: 'Transfer2 Shop', hwid: 'BM-AAAA-0000-BBBB-4444' });
  const seq3 = ((await g3.json()) as GenBody).seq;
  assert.equal((await post('/api/desk/transfer', { oldSeq: seq3, newHwid: 'BM-AAAA-0000-BBBB-4444' })).status, 400);
});

test('transfer can issue v2 for the new HWID', { skip: !HAS_KEY }, async () => {
  const g = await post('/api/desk/generate', { store: 'Transfer V2 Shop', hwid: 'BM-ABAB-0000-CDCD-1111' });
  const seq = ((await g.json()) as GenBody).seq;
  const t = await post('/api/desk/transfer', {
    oldSeq: seq, newHwid: 'BM-ABAB-0000-CDCD-2222', format: 'v2', v2: { tier: 'PERP' },
  });
  assert.equal(t.status, 200);
  const tr = (await t.json()) as { format: string; issue: { key: string } };
  assert.equal(tr.format, 'v2');
  assert.match(tr.issue.key, /^AK2-/);
});

test('audit records unlock + transfer mutations', { skip: !HAS_KEY }, async () => {
  const a = (await (await fetch(`${base}/api/desk/audit?last=100`)).json()) as {
    entries: Array<{ action: string; ok: boolean }>; count: number;
  };
  const kinds = new Set(a.entries.map(e => `${e.action}:${e.ok}`));
  assert.ok(kinds.has('unlock:true'));
  assert.ok(kinds.has('transfer:true'));
});

// KEEP LAST: this test deliberately exhausts the per-minute POST budget, so
// every POST test must be registered above it (sequential file order).
test('POST throttle trips with 429 past 240/min', async () => {
  let last = 0;
  for (let i = 0; i < 245; i++) {
    last = (await post('/api/desk/verify', { store: 'T', hwid: 'BM-1111-2222-3333-4444', key: 'AK-x' })).status;
  }
  assert.equal(last, 429);
});
