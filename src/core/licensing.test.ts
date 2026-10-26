import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sha256Hex, hmacSha256Hex } from './sha256';
import {
  computeHwid, generateActivationKey, validateLicense, evaluateTrial,
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
      hmacSha256Hex('BARAKA_MARKET_SECRET_ALGERIA_2026', 'Epicerie Nour||BM-AAAA-BBBB-CCCC-DDDD'),
      crypto.createHmac('sha256', 'BARAKA_MARKET_SECRET_ALGERIA_2026').update('Epicerie Nour||BM-AAAA-BBBB-CCCC-DDDD').digest('hex'),
    );
  });
});

describe('licensing: air-gapped BarakaLock', () => {
  const parts = { arch: 'x64', hostname: 'POS-01', osVersion: '10.0.19045', screen: '1366x768', seed: 'seed-1' };
  const hwid = computeHwid(parts);
  const store = 'Epicerie Nour';

  it('hwid is deterministic BM-XXXX-XXXX-XXXX-XXXX', () => {
    assert.match(hwid, /^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.equal(computeHwid(parts), hwid);
  });
  it('hwid changes when the seed changes', () => {
    assert.notEqual(computeHwid({ ...parts, seed: 'seed-2' }), hwid);
  });
  it('valid key verifies; AK-0000… + wrong store rejected', () => {
    const key = generateActivationKey(store, hwid);
    assert.match(key, /^AK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.equal(validateLicense(store, hwid, key), true);
    assert.equal(validateLicense(store, hwid, 'AK-0000-0000-0000-0000'), false);
    assert.equal(validateLicense('Autre Magasin', hwid, key), false);
    assert.equal(validateLicense(store, hwid, 'not-a-key'), false);
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
});
