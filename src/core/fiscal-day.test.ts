import { describe, it } from 'node:test';
import assert from 'node:assert';
import { fiscalDayISO, fiscalDayBoundsUTC } from './fiscal-day.ts';

describe('fiscal-day (F2: Africa/Algiers, never UTC)', () => {
  it('midday UTC stays the same local day', () => {
    assert.strictEqual(fiscalDayISO(new Date('2026-11-04T12:00:00Z')), '2026-11-04');
  });
  it('F2 edge: 00:30 Algiers belongs to the NEW local day (UTC still shows yesterday)', () => {
    // 2026-11-04T00:30:00+01:00 == 2026-11-03T23:30:00Z
    assert.strictEqual(fiscalDayISO(new Date('2026-11-03T23:30:00Z')), '2026-11-04');
  });
  it('F2 edge: 23:30 Algiers belongs to the SAME local day (UTC already tomorrow)', () => {
    // 2026-11-04T23:30:00+01:00 == 2026-11-04T22:30:00Z
    assert.strictEqual(fiscalDayISO(new Date('2026-11-04T22:30:00Z')), '2026-11-04');
  });
  it('bounds cover exactly the local day in UTC', () => {
    const b = fiscalDayBoundsUTC('2026-11-04');
    assert.strictEqual(b.start, '2026-11-03T23:00:00.000Z');
    assert.strictEqual(b.end, '2026-11-04T23:00:00.000Z');
  });
});
