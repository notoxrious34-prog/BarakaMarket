import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSemver, compareSemver, isNewer, checkForUpdate, relaunchApp, friendlyUpdateError } from './update-lane.js';

/** T9 (ADR-032): version math is pure; the bridge degrades outside Tauri. */
describe('update lane (T9)', () => {
  it('parses and compares semver (v-prefix, garbage, pre-release)', () => {
    assert.deepEqual(parseSemver('v1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseSemver('1.0'), [1, 0, 0]);
    assert.deepEqual(parseSemver('nope'), [0, 0, 0]);
    assert.equal(compareSemver('1.1.0', '1.0.9'), 1);
    assert.equal(compareSemver('1.0.1', '1.0.1'), 0);
    assert.equal(compareSemver('2.0.0-beta.1', '2.0.0'), 0); // suffix ignored
    assert.equal(compareSemver('1.0.1', '1.1.0'), -1);
    assert.ok(isNewer('1.1.0', '1.0.1'));
    assert.ok(!isNewer('1.0.1', '1.1.0'));
    assert.ok(!isNewer('1.0.1', '1.0.1'));
  });

  it('outside Tauri: check reports native-only, relaunch is false (no throw)', async () => {
    const { status, pending } = await checkForUpdate('1.0.1');
    assert.equal(status.available, false);
    assert.equal(status.reason, 'native-only');
    assert.equal(pending, null);
    assert.equal(await relaunchApp(), false);
  });

  it('audit 2026-11-11: failures speak guidance (FR/AR), never raw reqwest English', () => {
    const ar = friendlyUpdateError(true);
    assert.ok(ar.includes('USB') && ar.includes('الإنترنت'));
    assert.ok(!/error sending request/i.test(ar));
    const fr = friendlyUpdateError(false);
    assert.ok(fr.includes('USB') && fr.includes('connexion'));
    assert.ok(!/error sending request/i.test(fr));
  });
});
