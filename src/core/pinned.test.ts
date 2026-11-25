/**
 * ADR-053 P3 — pinned catalog core: fake-barcode guard + tile refs + NULL norm.
 * RED: this file FAILS until src/core/pinned.ts exists.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectFakeBarcode,
  normalizeBarcodeForDb,
  parseTileRef,
  FAKE_PATTERNS_DOC,
} from './pinned';

describe('detectFakeBarcode (anti-fake guard)', () => {
  it('real EAN-13 and internal codes pass as OK', () => {
    assert.equal(detectFakeBarcode('613000000001').kind, 'OK');
    assert.equal(detectFakeBarcode(' 613000000001 ').kind, 'OK');
    assert.equal(detectFakeBarcode('00040').kind, 'FAKE_SHORT'); // scale PLU shape still warns — owner overrides explicitly (control #4)
  });
  it('empty/whitespace normalizes to EMPTY (NULL at lane)', () => {
    assert.equal(detectFakeBarcode('').kind, 'EMPTY');
    assert.equal(detectFakeBarcode('   ').kind, 'EMPTY');
  });
  it('short numeric codes flag FAKE_SHORT', () => {
    for (const c of ['1', '12', '101', '2024', '97531']) {
      assert.equal(detectFakeBarcode(c).kind, 'FAKE_SHORT', c);
    }
  });
  it('repeated chars flag FAKE_REPEAT', () => {
    for (const c of ['00', '000000', '1111111', '9999999999', 'aaaaaaa']) {
      assert.equal(detectFakeBarcode(c).kind, 'FAKE_REPEAT', c);
    }
  });
  it('sequential runs flag FAKE_SEQ', () => {
    for (const c of ['1234', '1234567', '4321', '987654']) {
      assert.equal(detectFakeBarcode(c).kind, 'FAKE_SEQ', c);
    }
  });
  it('verdict carries a stable machine code + human hint key', () => {
    const v = detectFakeBarcode('123');
    assert.equal(v.code, 'FAKE_SHORT');
    assert.ok(typeof v.hintKey === 'string' && v.hintKey.length > 0);
    assert.ok(FAKE_PATTERNS_DOC.length > 0);
  });
});

describe('normalizeBarcodeForDb (control #1: no "" in DB)', () => {
  it('empty/whitespace becomes NULL', () => {
    assert.equal(normalizeBarcodeForDb(''), null);
    assert.equal(normalizeBarcodeForDb('   '), null);
    assert.equal(normalizeBarcodeForDb(null), null);
    assert.equal(normalizeBarcodeForDb(undefined), null);
  });
  it('real codes trim but survive', () => {
    assert.equal(normalizeBarcodeForDb('  613000000001 '), '613000000001');
    assert.equal(normalizeBarcodeForDb('00040'), '00040');
  });
});

describe('parseTileRef (#N refs, Aldi-style)', () => {
  it('parses #1..#12', () => {
    assert.equal(parseTileRef('#1'), 1);
    assert.equal(parseTileRef('#12'), 12);
    assert.equal(parseTileRef('  #4  '), 4);
  });
  it('rejects non-refs (EAN, scale, garbage)', () => {
    assert.equal(parseTileRef('613000000001'), null);
    assert.equal(parseTileRef('#0'), null);
    assert.equal(parseTileRef('#13'), null);
    assert.equal(parseTileRef('#'), null);
    assert.equal(parseTileRef('N*CODE'), null);
    assert.equal(parseTileRef(''), null);
  });
});
