import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadRapideMemory, rememberRapideSale, getRapideRecents, getPinnedRapides, toggleRapidePin,
} from './rapide-memory';

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
  };
}

describe('rapide-memory ADR-051 P1', () => {
  it('records sales and prefills from the label', () => {
    const s = memStore();
    assert.deepEqual(loadRapideMemory(s), {});
    rememberRapideSale(s, { label: 'خبز الشعير', priceTtcCt: 3000, tva: 9, unit: 'PIECE', vendor: 'النور' }, 1000);
    const mem = rememberRapideSale(s, { label: 'خبز الشعير', priceTtcCt: 3200, tva: 9, unit: 'PIECE' }, 2000);
    assert.equal(mem['خبز الشعير'].priceTtcCt, 3200);
    assert.equal(mem['خبز الشعير'].uses, 2);
    assert.equal(mem['خبز الشعير'].vendor, 'النور'); // vendor survives
  });
  it('recents come most-recent-first, pins are listed', () => {
    const s = memStore();
    rememberRapideSale(s, { label: 'A', priceTtcCt: 100, tva: 9, unit: 'PIECE' }, 1000);
    rememberRapideSale(s, { label: 'B', priceTtcCt: 200, tva: 19, unit: 'KG' }, 2000);
    toggleRapidePin(s, 'A');
    const mem = loadRapideMemory(s);
    assert.deepEqual(getRapideRecents(mem, 8).map(e => e.label), ['B', 'A']);
    assert.deepEqual(getPinnedRapides(mem).map(e => e.label), ['A']);
    toggleRapidePin(s, 'A');
    assert.deepEqual(getPinnedRapides(loadRapideMemory(s)), []);
  });
  it('garbage and tampered stores load as empty, cap prunes oldest', () => {
    const s = memStore();
    s.setItem('baraka_rapide_v1', '{bad json');
    assert.deepEqual(loadRapideMemory(s), {});
    s.setItem('baraka_rapide_v1', JSON.stringify({ X: { priceTtcCt: -5, tva: 99 } }));
    assert.deepEqual(loadRapideMemory(s), {});
    const s2 = memStore();
    for (let i = 0; i < 105; i++) {
      rememberRapideSale(s2, { label: `L${i}`, priceTtcCt: 100 + i, tva: 9, unit: 'PIECE' }, i);
    }
    assert.equal(Object.keys(loadRapideMemory(s2)).length, 100);
  });
});
