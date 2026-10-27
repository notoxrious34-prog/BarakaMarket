import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sha256Hex, hmacSha256Hex } from './sha256';
import {
  computeHwid, validateLicense, verifyEd25519Signature, buildLicensePayload,
  formatActivationKey, canonicalStoreName, evaluateTrial, BARAKA_PUBLIC_KEY,
  TRIAL_MAX_SALES, TRIAL_MAX_DAYS,
} from './licensing';

/** Cross-validate the pure-TS SHA-256 against Node's OpenSSL binding. */
describe('sha256: byte-identical to Node crypto', () => {
  for (const v of ['', 'abc', 'Baraka Market بركة', 'x'.repeat(1000), 'FACT-2026-000101||T-2026-000042']) {
    it(`matches for ${JSON.stringify(v).slice(0, 32)}`, () => {
      assert.equal(sha256Hex(v), crypto.createHash('sha256').update(v, 'utf8').digest('hex'));
    });
  }
  it('hmac matches Node crypto', () => {
    assert.equal(
      hmacSha256Hex('probe-key', 'Epicerie Nour||BM-AAAA-BBBB-CCCC-DDDD'),
      crypto.createHmac('sha256', 'probe-key').update('Epicerie Nour||BM-AAAA-BBBB-CCCC-DDDD').digest('hex'),
    );
  });
});

describe('licensing: air-gapped BarakaLock (Ed25519, ADR-002)', () => {
  const parts = { arch: 'x64', hostname: 'POS-01', osVersion: '10.0.19045', seed: 'seed-1' };
  const hwid = computeHwid(parts);
  const store = 'Epicerie Nour';

  // Ephemeral owner pair — mirrors scripts/keygen.ts (Node sign → client verify).
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const ephPubHex = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toString('hex');
  const signFor = (s: string, h: string): string =>
    formatActivationKey(crypto.sign(null, buildLicensePayload(s, h), privateKey).toString('base64url'));

  it('hwid is deterministic BM-XXXX-XXXX-XXXX-XXXX', () => {
    assert.match(hwid, /^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.equal(computeHwid(parts), hwid);
  });
  it('hwid ignores screen resolution (monitor swaps do not void keys)', () => {
    const withScreen = computeHwid({ ...parts, screen: '1920x1080' } as typeof parts & { screen: string });
    assert.equal(withScreen, hwid);
    assert.notEqual(computeHwid({ ...parts, seed: 'seed-2' }), hwid);
  });
  it('ephemeral Ed25519 key verifies; wrong store/hwid/sig rejected', async () => {
    const key = signFor(store, hwid);
    assert.match(key, /^AK-[A-Za-z0-9_-]{86}$/);
    assert.equal(await verifyEd25519Signature(ephPubHex, buildLicensePayload(store, hwid), key.slice(3)), true);
    assert.equal(await verifyEd25519Signature(ephPubHex, buildLicensePayload('Autre Magasin', hwid), key.slice(3)), false);
    const tampered = key.slice(0, 10) + (key[10] === 'A' ? 'B' : 'A') + key.slice(11);
    assert.equal(await verifyEd25519Signature(ephPubHex, buildLicensePayload(store, hwid), tampered.slice(3)), false);
    assert.equal(await verifyEd25519Signature('00'.repeat(32), buildLicensePayload(store, hwid), key.slice(3)), false);
  });
  it('production public key rejects garbage, wrong shapes, empty fields', async () => {
    assert.equal(await validateLicense(store, hwid, 'AK-0000'), false);
    assert.equal(await validateLicense(store, hwid, 'not-a-key'), false);
    assert.equal(await validateLicense('', hwid, `AK-${'A'.repeat(86)}`), false);
    assert.equal(await validateLicense(store, '', `AK-${'A'.repeat(86)}`), false);
    assert.equal(await validateLicense(store, hwid, `AK-${'A'.repeat(86)}`), false); // well-formed, wrong sig
  });
  it('store canonicalization: case/space-insensitive', () => {
    assert.equal(canonicalStoreName('  epicerie nour '), canonicalStoreName('EPICERIE NOUR'));
  });
  it('trial envelope: 50 sales / 14 days', () => {
    const now = Date.now();
    const t = evaluateTrial('TRIAL', 49, now - 13 * 86400000, now);
    assert.equal(t.salesRemaining, TRIAL_MAX_SALES - 49);
    assert.equal(t.daysRemaining, TRIAL_MAX_DAYS - 13);
    const exhausted = evaluateTrial('TRIAL', 50, now, now);
    assert.equal(exhausted.salesRemaining, 0);
    const active = evaluateTrial('ACTIVATED', 5000, now - 900 * 86400000, now);
    assert.equal(active.status, 'ACTIVATED');
    assert.equal(active.salesRemaining, Number.POSITIVE_INFINITY);
  });
  it('embedded production public key is a 32-byte hex constant', () => {
    assert.match(BARAKA_PUBLIC_KEY, /^[0-9a-f]{64}$/);
  });
});
