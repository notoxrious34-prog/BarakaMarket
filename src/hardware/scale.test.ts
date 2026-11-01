import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseScaleFrame, StableWeight, connectLiveScale } from './scale.js';

/** T6 (ADR-029): scale frames parse, stability votes, serial guards. */
describe('scale lane (T6)', () => {
  it('parses CAS/DIGI stable + unstable frames', () => {
    assert.deepEqual(parseScaleFrame('ST,GS,+  1.450kg'), { grams: 1450, stable: true });
    assert.deepEqual(parseScaleFrame('US,GS,+  1.452kg'), { grams: 1452, stable: false });
    assert.deepEqual(parseScaleFrame('ST,NT,- 12g'), { grams: -12, stable: true });
  });

  it('parses Mettler SICS and bare frames', () => {
    assert.deepEqual(parseScaleFrame('S S   1.450 kg'), { grams: 1450, stable: true });
    assert.deepEqual(parseScaleFrame('S D   1.451 kg'), { grams: 1451, stable: false });
    assert.deepEqual(parseScaleFrame('1450g'), { grams: 1450, stable: false });
    assert.deepEqual(parseScaleFrame('+ 2.000 kg'), { grams: 2000, stable: false });
  });

  it('rejects tare echoes, banners and garbage', () => {
    assert.equal(parseScaleFrame(''), null);
    assert.equal(parseScaleFrame('T 0.000 kg'), null);
    assert.equal(parseScaleFrame('CAS SW-1  REV 2.1'), null);
    assert.equal(parseScaleFrame('....'), null);
  });

  it('device-stable flag wins immediately', () => {
    const v = new StableWeight();
    assert.deepEqual(v.push({ grams: 1450, stable: true }), { grams: 1450, stable: true });
  });

  it('votes stable after N consecutive readings in tolerance', () => {
    const v = new StableWeight(3, 2);
    assert.equal(v.push({ grams: 1448, stable: false }).stable, false);
    assert.equal(v.push({ grams: 1450, stable: false }).stable, false);
    const third = v.push({ grams: 1449, stable: false });
    assert.equal(third.stable, true);
    assert.ok(Math.abs(third.grams - 1449) <= 1);
  });

  it('flapping weight never votes stable', () => {
    const v = new StableWeight(3, 2);
    for (const g of [1400, 1500, 1300, 1600, 1450]) {
      assert.equal(v.push({ grams: g, stable: false }).stable, false);
    }
  });

  it('Web Serial absent (Node/tests) => unsupported, never throws', async () => {
    const ctl = new AbortController();
    const st = await connectLiveScale(() => {}, ctl.signal);
    assert.equal(st, 'unsupported');
  });
});
