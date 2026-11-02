/**
 * C3: ceiling bar — ratio clamp + tone thresholds + unlimited hides.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ceilingBar } from './ceiling-bar.js';

test('C3: tones at 70/100 boundaries', () => {
  assert.deepEqual(ceilingBar(0, 100000), { pct: 0, tone: 'green' });
  assert.deepEqual(ceilingBar(69999, 100000), { pct: 70, tone: 'amber' });
  assert.deepEqual(ceilingBar(70000, 100000), { pct: 70, tone: 'amber' });
  assert.deepEqual(ceilingBar(99999, 100000), { pct: 100, tone: 'red' });
  assert.deepEqual(ceilingBar(150000, 100000), { pct: 100, tone: 'red' });
  assert.equal(ceilingBar(50000, 100000).tone, 'green');
});

test('C3: unlimited ceiling hides the bar; negatives clamp', () => {
  assert.deepEqual(ceilingBar(5000, 0), { pct: null, tone: 'none' });
  assert.deepEqual(ceilingBar(-2000, 100000), { pct: 0, tone: 'green' });
});
