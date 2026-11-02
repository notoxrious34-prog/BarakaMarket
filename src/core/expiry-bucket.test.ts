/**
 * C4: expiry buckets — expired past midnight, soon ≤15d, bad dates safe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryBucket } from './expiry-bucket.js';

const T = new Date('2026-11-02T12:00:00').getTime();

test('C4: past dates are expired, today is soon', () => {
  assert.equal(expiryBucket(true, '2026-11-01', T), 'expired');
  assert.equal(expiryBucket(true, '2026-11-02', T), 'soon');
  assert.equal(expiryBucket(true, '2026-11-17', T), 'soon');
  assert.equal(expiryBucket(true, '2026-11-18', T), 'later');
});

test('C4: no date / bad date never alerts', () => {
  assert.equal(expiryBucket(false, '2026-11-01', T), 'none');
  assert.equal(expiryBucket(true, undefined, T), 'none');
  assert.equal(expiryBucket(true, 'not-a-date', T), 'none');
});
