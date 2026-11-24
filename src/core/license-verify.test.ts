/**
 * license-verify tests (L-lane): trust-on-read is over.
 * Every rule runs against an injected verifier — no crypto, no flakiness.
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { assessStoredLicense } from './license-verify';
import type { StoredLicense } from './license-store';

const rec = (hwid?: string): StoredLicense => ({
  status: 'ACTIVATED', storeName: 'NOUR', key: 'AK-good',
  installedAtMs: 1, ...(hwid === undefined ? {} : { hwid }),
});

describe('license-verify (L-lane)', () => {
  it('L1: genuine key + same machine => cryptoOk, no drift', async () => {
    const a = await assessStoredLicense(rec('BM-AAAA-AAAA-AAAA-AAAA'), 'BM-AAAA-AAAA-AAAA-AAAA', async () => true);
    assert.deepEqual(a, { cryptoOk: true, drift: false, migrated: false });
  });
  it('L1: forged key => crypto fails even with matching hwid', async () => {
    const a = await assessStoredLicense(rec('BM-AAAA-AAAA-AAAA-AAAA'), 'BM-AAAA-AAAA-AAAA-AAAA', async () => false);
    assert.equal(a.cryptoOk, false);
  });
  it('drift: genuine key on a new machine => crypto holds, drift warns (no lock)', async () => {
    const seen: string[] = [];
    const a = await assessStoredLicense(rec('BM-AAAA-AAAA-AAAA-AAAA'), 'BM-BBBB-BBBB-BBBB-BBBB', async (_s, h) => { seen.push(h); return true; });
    assert.deepEqual(a, { cryptoOk: true, drift: true, migrated: false });
    assert.deepEqual(seen, ['BM-AAAA-AAAA-AAAA-AAAA']); // verified against the ACTIVATION hwid
  });
  it('legacy: no stored hwid => verified against current, drift warns', async () => {
    const seen: string[] = [];
    const a = await assessStoredLicense(rec(undefined), 'BM-CCCC-CCCC-CCCC-CCCC', async (_s, h) => { seen.push(h); return true; });
    assert.deepEqual(a, { cryptoOk: true, drift: true, migrated: false });
    assert.deepEqual(seen, ['BM-CCCC-CCCC-CCCC-CCCC']);
  });
  it('ADR-050: activation hwid in the legacy list => migrated (warning-only)', async () => {
    const a = await assessStoredLicense(rec('BM-AAAA-AAAA-AAAA-AAAA'), 'BM-NEW-HWID-1234', async () => true, ['BM-AAAA-AAAA-AAAA-AAAA']);
    assert.deepEqual(a, { cryptoOk: true, drift: true, migrated: true });
  });
  it('ADR-050: unknown hwid is NOT migration (lock path preserved)', async () => {
    const a = await assessStoredLicense(rec('BM-AAAA-AAAA-AAAA-AAAA'), 'BM-NEW-HWID-1234', async () => true, ['BM-OTHER-OTHER-OTHER']);
    assert.deepEqual(a, { cryptoOk: true, drift: true, migrated: false });
  });
});
