import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tillOutcomeLabel, isTillPosted } from './till-outcome';

// MKT-008 regression (AUDIT Minor): the old boolean collapsed "no session"
// and "lane unreachable" into one `false` → the UI lied "hors-caisse" while
// the ledger debited 530000 Caisse. Three outcomes stay distinct forever.
describe('till-outcome (MKT-008)', () => {
  it('three outcomes are distinct and posted-only counts as till', () => {
    assert.equal(isTillPosted('posted'), true);
    assert.equal(isTillPosted('no-session'), false);
    assert.equal(isTillPosted('lane-down'), false);
  });
  it('lane-down warns honestly (AR + FR) — never "hors-caisse"', () => {
    const ar = tillOutcomeLabel('lane-down', true);
    const fr = tillOutcomeLabel('lane-down', false);
    assert.match(ar, /المسار|الصندوق/);
    assert.ok(!ar.includes('خارج الصندوق'), 'must not claim hors-caisse');
    assert.ok(!fr.includes('hors-caisse'), 'must not claim hors-caisse');
  });
  it('posted and no-session keep their legacy sentences', () => {
    assert.match(tillOutcomeLabel('posted', true), /خرج من الصندوق/);
    assert.match(tillOutcomeLabel('no-session', true), /خارج الصندوق/);
    assert.match(tillOutcomeLabel('posted', false), /till/);
    assert.match(tillOutcomeLabel('no-session', false), /hors-caisse/);
  });
});
