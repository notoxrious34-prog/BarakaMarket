import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectVersionShift } from './version-change.js';

test('version-change: fresh install is silent', () => {
  assert.equal(detectVersionShift(null, '1.4.2'), 'fresh');
  assert.equal(detectVersionShift('', '1.4.2'), 'fresh');
});

test('version-change: same version, no audit', () => {
  assert.equal(detectVersionShift('1.4.1', '1.4.1'), 'same');
});

test('version-change: upgrade detected (the 1.4.0 -> 1.4.1 iron jump)', () => {
  assert.equal(detectVersionShift('1.4.0', '1.4.1'), 'upgraded');
  assert.equal(detectVersionShift('1.3.5', '1.4.2'), 'upgraded');
});

test('version-change: downgrade detected (rollback install)', () => {
  assert.equal(detectVersionShift('1.4.1', '1.4.0'), 'downgraded');
});

test('version-change: unparseable change still audited as upgrade', () => {
  assert.equal(detectVersionShift('dev', '1.4.2'), 'upgraded');
});
