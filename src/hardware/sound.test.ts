import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanBeep,
  errorBuzz,
  cashChime,
  hardwareAvailable,
  SCAN_START_HZ,
  SCAN_END_HZ,
  SCAN_MS,
  SCAN_GAIN,
  ERR_HZ_A,
  ERR_HZ_B,
  ERR_MS,
  CASH_HZ_1,
  CASH_MS_1,
  CASH_HZ_2,
  CASH_MS_2,
} from './sound.js';

test('sound: spec constants match Gate-02 contract', () => {
  assert.equal(SCAN_START_HZ, 880);
  assert.equal(SCAN_END_HZ, 1760);
  assert.equal(SCAN_MS, 45);
  assert.equal(SCAN_GAIN, 0.15);
  assert.equal(ERR_HZ_A, 180);
  assert.equal(ERR_HZ_B, 185);
  assert.equal(ERR_MS, 150);
  assert.equal(CASH_HZ_1, 1046.5);
  assert.equal(CASH_MS_1, 60);
  assert.equal(CASH_HZ_2, 1318.5);
  assert.equal(CASH_MS_2, 80);
});

test('sound: headless runtime degrades silently (no throw, no assets)', () => {
  assert.equal(hardwareAvailable(), false);
  assert.doesNotThrow(() => {
    assert.equal(scanBeep(), false);
    assert.equal(errorBuzz(), false);
    assert.equal(cashChime(), false);
  });
});
