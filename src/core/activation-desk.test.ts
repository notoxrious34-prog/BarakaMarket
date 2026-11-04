import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeHwid, parseDeskArgs, ledgerAppend, ledgerVerify, ledgerParse,
  renderReceipt, ledgerHash,
} from './activation-desk.js';

test('desk: HWID canonicalization salvages human input, rejects garbage', () => {
  assert.equal(canonicalizeHwid('bm-1111-2222-3333-4444'), 'BM-1111-2222-3333-4444');
  assert.equal(canonicalizeHwid('  1111222233334444  '), 'BM-1111-2222-3333-4444');
  assert.equal(canonicalizeHwid('BM1111222233334444'), 'BM-1111-2222-3333-4444');
  assert.equal(canonicalizeHwid('BM 1111 2222 3333 4444'), 'BM-1111-2222-3333-4444');
  assert.equal(canonicalizeHwid('BM-1111-2222-3333-4444'), 'BM-1111-2222-3333-4444');
  assert.equal(canonicalizeHwid('nope'), null);
  assert.equal(canonicalizeHwid('BM-1111-2222-3333'), null);
  assert.equal(canonicalizeHwid('BM-ZZZZ-2222-3333-4444'), null);
  assert.equal(canonicalizeHwid(''), null);
});

test('desk: arg parser routes commands and flags', () => {
  assert.deepEqual(parseDeskArgs(['generate', '--store', 'S', '--hwid', 'H', '--json', '--yes']),
    { name: 'generate', store: 'S', hwid: 'H', keyFile: undefined, json: true, yes: true });
  assert.deepEqual(parseDeskArgs(['verify', '--store=S', '--key=AK-x']),
    { name: 'verify', store: 'S', hwid: undefined, key: 'AK-x', json: false });
  assert.deepEqual(parseDeskArgs(['ledger', '--verify']), { name: 'ledger', verify: true, csv: false, last: 10, revoke: null });
  assert.deepEqual(parseDeskArgs(['ledger', '--revoke', '3']), { name: 'ledger', verify: false, csv: false, last: 10, revoke: 3 });
  assert.equal(parseDeskArgs([]).name, 'help');
  assert.equal(parseDeskArgs(['frobnicate']).name, 'help');
});

test('desk: ledger chain links, verifies, and detects tampering + bad JSON', () => {
  const e1 = ledgerAppend([], { ts: '2026-11-04T10:00:00.000Z', kind: 'issue', store: 'A', hwid: 'H1', key: 'K1' });
  assert.equal(e1.seq, 1);
  assert.equal(e1.prev, '0'.repeat(64));
  const e2 = ledgerAppend([e1], { ts: '2026-11-04T11:00:00.000Z', kind: 'issue', store: 'B', hwid: 'H2', key: 'K2' });
  assert.equal(e2.prev, e1.hash);
  assert.deepEqual(ledgerVerify([e1, e2]), { brokenAt: null, count: 2 });
  // Tampered store breaks at seq 2.
  const bad = { ...e2, store: 'EVIL' };
  assert.equal(ledgerVerify([e1, bad]).brokenAt, 2);
  // Spliced-out entry breaks linkage.
  assert.equal(ledgerVerify([e2]).brokenAt, 2);
  // JSONL round-trip.
  const parsed = ledgerParse(`${JSON.stringify(e1)}\n\n${JSON.stringify(e2)}\n`);
  assert.equal(parsed.length, 2);
  assert.throws(() => ledgerParse('{"seq":1}\nnot-json\n'), /line 2/);
  // Revocation marker chains too.
  const e3 = ledgerAppend([e1, e2], { ts: '2026-11-04T12:00:00.000Z', kind: 'revoke', store: 'A', hwid: 'H1', key: 'K1', note: 'shop closed' });
  assert.equal(e3.kind, 'revoke');
  assert.deepEqual(ledgerVerify([e1, e2, e3]).brokenAt, null);
});

test('desk: receipt carries the key once with price anchor', () => {
  const r = renderReceipt('EPI NOUR', 'BM-1', 'AK-x', 7, 5000);
  assert.equal(r.match(/AK-x/g)?.length, 2); // card line + SMS line
  assert.match(r, /#7/);
  assert.match(r, /5000 DZD/);
  assert.match(r, /VALID/);
});

test('desk: ledgerHash is stable and 64-hex', () => {
  const h = ledgerHash('p', 1, 't', 'issue', 'S', 'H', 'K');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, ledgerHash('p', 1, 't', 'issue', 'S', 'H', 'K'));
});
