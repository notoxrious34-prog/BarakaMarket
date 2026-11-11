import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReturnsHealth } from './returns-health.js';

/**
 * ADR-045 — returns health kernel: pure day-desk counters.
 * RED first: the module does not exist yet.
 */
test('returns-health: counts drafts / approved / quarantine / open claims', () => {
  const rows = [
    { status: 'DRAFT' }, { status: 'DRAFT' },
    { status: 'APPROVED' }, { status: 'REJECTED' },
  ] as never[];
  const h = computeReturnsHealth(rows, [{}, {}] as never[], [
    { status: 'OPEN' }, { status: 'SETTLED' }, { status: 'OPEN' },
  ] as never[]);
  assert.equal(h.drafts, 2);
  assert.equal(h.approved, 1);
  assert.equal(h.quarantined, 2);
  assert.equal(h.openClaims, 2);
});

test('returns-health: empty desk is all zeros (never NaN)', () => {
  const h = computeReturnsHealth([], [], []);
  assert.deepEqual(h, { drafts: 0, approved: 0, quarantined: 0, openClaims: 0 });
});
