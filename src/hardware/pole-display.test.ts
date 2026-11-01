import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  POLE_COLS, POLE_CLEAR, POLE_CR,
  poleLine, poleBrightness,
  buildPoleWelcome, buildPoleTotal, buildPoleTendered, buildPoleThanks,
} from './pole-display.js';

/** T5 (ADR-028): 2x20 VFD frames are byte-exact and deterministic. */
describe('pole display (T5)', () => {
  it('poleLine is always exactly 20 columns', () => {
    assert.equal(poleLine('hi').length, POLE_COLS);
    assert.equal(poleLine('x'.repeat(40)).length, POLE_COLS);
    assert.deepEqual(poleLine('AB'), [0x41, 0x42, ...new Array(18).fill(0x20)]);
  });

  it('brightness clamps to 0..4 with the ESC * prefix', () => {
    assert.deepEqual(poleBrightness(9), [0x1b, 0x2a, 4]);
    assert.deepEqual(poleBrightness(-2), [0x1b, 0x2a, 0]);
  });

  it('welcome frame: clear + store + fiscal tag', () => {
    const f = buildPoleWelcome('BARAKA MARKET');
    assert.equal(f[3], POLE_CLEAR);
    const text = new TextDecoder().decode(f.slice(4));
    assert.ok(text.includes('BARAKA MARKET'));
    assert.ok(text.includes('MODE FISCAL ACTIF'));
    assert.ok(text.includes(String.fromCharCode(POLE_CR)));
  });

  it('total frame carries the amount due', () => {
    const text = new TextDecoder().decode(buildPoleTotal(1794));
    assert.ok(text.includes('TOTAL A PAYER'));
    assert.ok(text.includes('1794.00 DZD'));
  });

  it('tendered frame: cash shows change, card shows thanks', () => {
    const cash = new TextDecoder().decode(buildPoleTendered(2000, 206, 'ESPECES'));
    assert.ok(cash.includes('RENDU 206.00'));
    const card = new TextDecoder().decode(buildPoleTendered(1794, 0, 'CIB'));
    assert.ok(card.includes('CIB MERCI'));
  });

  it('thanks frame is deterministic across builds', () => {
    assert.deepEqual(Array.from(buildPoleThanks()), Array.from(buildPoleThanks()));
  });
});
