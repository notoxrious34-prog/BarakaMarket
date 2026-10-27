import test from 'node:test';
import assert from 'node:assert/strict';
import { BurstDetector, BURST_MAX_INTERVAL_MS } from './scanner.js';
import { parseScaleBarcodeCt } from '../core/fiscal.centimes.js';
import { calculateLineTotalsCt } from '../core/fiscal.centimes.js';
import { dzdToCentimes } from '../core/money.js';

function feed(det: BurstDetector, code: string, gapMs: number): string | null {
  let t = 1000;
  let out: string | null = null;
  for (const ch of code) {
    t += gapMs;
    out = det.key(ch, t, false) ?? out;
  }
  t += gapMs;
  return det.key(null, t, true) ?? out;
}

test('scanner: hardware burst (<30ms) + Enter emits barcode', () => {
  const det = new BurstDetector();
  const out = feed(det, '613000000014', 8);
  assert.equal(out, '613000000014');
});

test('scanner: human typing (slow gaps) + Enter is ignored', () => {
  const det = new BurstDetector();
  const out = feed(det, '613000000014', BURST_MAX_INTERVAL_MS + 50);
  assert.equal(out, null);
});

test('scanner: short fragments + Enter are ignored (no cart pollution)', () => {
  const det = new BurstDetector();
  assert.equal(feed(det, 'ab', 5), null);
});

test('scanner: burst detector resets after emit (second scan works)', () => {
  const det = new BurstDetector();
  assert.equal(feed(det, '613000000014', 8), '613000000014');
  assert.equal(feed(det, '2000145014508', 8), '2000145014508');
});

test('scale: 2000145014502 -> item 00145, 1450 g, centimes line total', () => {
  const r = parseScaleBarcodeCt('2000145014502');
  assert.equal(r.isScale, true);
  assert.equal(r.itemCode, '00145');
  assert.equal(r.weightGrams, 1450);
  // 280 DZD/kg x 1.450 kg = 40600 ct exact, HT = round(40600*100/109) = 37248 ct
  const line = calculateLineTotalsCt(dzdToCentimes(280), 1.45, 9);
  assert.equal(line.total_line_ttc_ct, 40600);
  assert.equal(line.total_line_ht_ct + line.total_line_tva_ct, 40600);
});
