import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { laneVerdict, trialAliveFor, subscriptionExpiredFor } from './license-gate';

const base = {
  activated: false, keyGenuine: null as boolean | null, subscriptionExpired: false,
  publishedGateDenied: false, overrideValid: false, trialAlive: true,
};

describe('license-gate ADR-050: lane verdicts', () => {
  it('override wins over everything', () => {
    assert.deepEqual(laneVerdict({ ...base, overrideValid: true, publishedGateDenied: true }), { ok: true });
  });
  it('published deny locks the lane', () => {
    assert.deepEqual(laneVerdict({ ...base, publishedGateDenied: true }), { ok: false, reason: 'LICENSE_DENIED' });
  });
  it('published deny carries its reason (parity with the Rust lane)', () => {
    assert.deepEqual(laneVerdict({ ...base, publishedGateDenied: 'LICENSE_KEY_INVALID' }), { ok: false, reason: 'LICENSE_KEY_INVALID' });
    assert.deepEqual(laneVerdict({ ...base, publishedGateDenied: 'LICENSE_TRIAL_EXPIRED' }), { ok: false, reason: 'LICENSE_TRIAL_EXPIRED' });
  });
  it('forged activated key refuses even with live trial', () => {
    assert.deepEqual(laneVerdict({ ...base, activated: true, keyGenuine: false }), { ok: false, reason: 'LICENSE_KEY_INVALID' });
  });
  it('activated + unverified-here (Rust) allows unless the gate denies', () => {
    assert.deepEqual(laneVerdict({ ...base, activated: true, keyGenuine: null }), { ok: true });
  });
  it('expired trial refuses when no license', () => {
    assert.deepEqual(laneVerdict({ ...base, trialAlive: false }), { ok: false, reason: 'LICENSE_TRIAL_EXPIRED' });
  });
  it('live trial allows', () => {
    assert.deepEqual(laneVerdict({ ...base }), { ok: true });
  });
});

describe('license-gate: trial budgets + v2 expiry reads', () => {
  it('budgets need ONE of sales/days (50 sales AND 14 days exhausts)', () => {
    assert.equal(trialAliveFor(50, 1, 1 + 14 * 86400000), false);
    assert.equal(trialAliveFor(49, 1, 1 + 14 * 86400000), true);
    assert.equal(trialAliveFor(50, Date.now(), Date.now()), true);
  });
  it('v1 keys never expire by subscription', () => {
    assert.equal(subscriptionExpiredFor('AK-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', Date.now()), false);
  });
});
