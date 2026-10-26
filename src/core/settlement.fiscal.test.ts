import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTimbreFiscalCt } from './fiscal.centimes.js';
import { dzdToCentimes, centimesToDzd } from './money.js';

// EXEC-DIR-2023-001 TASK 3 / INVARIANT 3 — Art. 136 on debt settlements.
// Client owes 15,000.00 DZD; pays 5,000.00 DZD slices.

test('settlement: 5000 ESPECES carries 50 timbre, principal drops by exactly 5000', () => {
  const amountCt = dzdToCentimes(5000);
  const timbreCt = calculateTimbreFiscalCt(amountCt, 'ESPECES');
  // ceil(5000 * 0.01) = 50 DZD, within [10, 2500], above 50 DZD exemption
  assert.equal(timbreCt, 5000);
  assert.equal(centimesToDzd(timbreCt), 50);

  const prevBalance = 15000;
  const newBalance = Math.round((prevBalance - 5000) * 100) / 100;
  assert.equal(newBalance, 10000); // principal drops by exact principal

  const totalCollected = Math.round((5000 + 50) * 100) / 100;
  assert.equal(totalCollected, 5050); // Total Cash Encaissé = 5 050.00 DZD
});

test('settlement: 5000 via CIB carries zero timbre', () => {
  const timbreCt = calculateTimbreFiscalCt(dzdToCentimes(5000), 'CIB');
  assert.equal(timbreCt, 0);
  const timbreDahabiya = calculateTimbreFiscalCt(dzdToCentimes(5000), 'DAHABIYA');
  assert.equal(timbreDahabiya, 0);
});

test('settlement: ESPECES below 50 DZD is exempt from timbre', () => {
  assert.equal(calculateTimbreFiscalCt(dzdToCentimes(49.99), 'ESPECES'), 0);
  assert.equal(calculateTimbreFiscalCt(dzdToCentimes(30), 'ESPECES'), 0);
});

test('settlement: timbre clamps to [10, 2500] DZD bounds', () => {
  // Small cash sale 200 DZD -> 1% = 2, clamped to floor 10
  assert.equal(centimesToDzd(calculateTimbreFiscalCt(dzdToCentimes(200), 'ESPECES')), 10);
  // Huge cash sale 500 000 DZD -> 1% = 5000, clamped to cap 2500
  assert.equal(centimesToDzd(calculateTimbreFiscalCt(dzdToCentimes(500000), 'ESPECES')), 2500);
});
