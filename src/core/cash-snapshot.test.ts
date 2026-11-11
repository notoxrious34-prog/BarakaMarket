import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCashSnapshot } from './cash-snapshot';

// MKT-010 regression: the cash snapshot loader (extracted from
// CashSessionsView.refresh) keeps the cold-start retry and the
// open/none/down branches. Fails before the module exists.
describe('cash-snapshot (MKT-010)', () => {
  const openRow = { id: 'S1', cashierName: 'Amine', openedAt: 't', status: 'OPEN' };
  const active = { session: { id: 'S1', cashierName: 'Amine', openedAt: 't' }, theoreticalCashCt: 100000 };
  it('open session: history + movements + live active', async () => {
    const snap = await loadCashSnapshot({
      sessions: async () => [openRow],
      movements: async () => [{ id: 'M1' }],
      active: async () => active,
    });
    assert.equal(snap.laneAlive, true);
    assert.equal(snap.history.length, 1);
    assert.equal(snap.openId, 'S1');
    assert.equal(snap.movements.length, 1);
    assert.equal(snap.active?.theoreticalCashCt, 100000);
  });
  it('no open session: live null, movements from newest row', async () => {
    const snap = await loadCashSnapshot({
      sessions: async () => [{ ...openRow, id: 'S0', status: 'CLOSED' }],
      movements: async () => [{ id: 'M0' }],
      active: async () => null,
    });
    assert.equal(snap.openId, null);
    assert.equal(snap.active, null);
    assert.equal(snap.movements.length, 1);
  });
  it('lane down twice: laneAlive false, empty snapshot (never a fossil)', async () => {
    const snap = await loadCashSnapshot({
      sessions: async () => null,
      movements: async () => null,
      active: async () => null,
    }, 1);
    assert.equal(snap.laneAlive, false);
    assert.deepEqual(snap.history, []);
    assert.equal(snap.active, null);
  });
  it('cold-start race: first probe null, retry wins', async () => {
    let calls = 0;
    const snap = await loadCashSnapshot({
      sessions: async () => (++calls === 1 ? null : [openRow]),
      movements: async () => [],
      active: async () => active,
    }, 1);
    assert.equal(calls, 2);
    assert.equal(snap.laneAlive, true);
  });
});
