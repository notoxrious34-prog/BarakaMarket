import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advancesForMonth, settleSalaryMath, applyAdvanceToBalance, applyPaydayToBalance } from './payroll.js';

test('payroll: advances filtered by worker + month', () => {
  const advs = [
    { workerId: 1, date: '2026-11-05', amountCt: 500000 },
    { workerId: 1, date: '2026-10-20', amountCt: 999999 },
    { workerId: 2, date: '2026-11-06', amountCt: 111111 },
  ];
  assert.equal(advancesForMonth(advs, 1, '2026-11'), 500000);
  assert.equal(advancesForMonth(advs, 2, '2026-11'), 111111);
  assert.equal(advancesForMonth(advs, 1, '2026-12'), 0);
});

test('payroll: payday nets salary minus advances', () => {
  assert.deepEqual(settleSalaryMath(3000000, 500000), { netPaidCt: 2500000, carryCt: 0 });
  assert.deepEqual(settleSalaryMath(3000000, 0), { netPaidCt: 3000000, carryCt: 0 });
});

test('payroll: excess advances carry as worker debt', () => {
  assert.deepEqual(settleSalaryMath(2000000, 2500000), { netPaidCt: 0, carryCt: 500000 });
});

test('payroll: bad money rejected', () => {
  assert.throws(() => settleSalaryMath(12.5, 0), /bad base/);
  assert.throws(() => settleSalaryMath(100, -5), /bad advances/);
  assert.throws(() => applyAdvanceToBalance(0, 0), /bad amount/);
});

test('payroll: balances track advances and payday clearing', () => {
  let b = applyAdvanceToBalance(0, 500000);
  assert.equal(b, 500000);
  b = applyPaydayToBalance(b, 500000);
  assert.equal(b, 0);
  b = applyAdvanceToBalance(0, 2500000);
  b = applyPaydayToBalance(b, 2000000); // only base worth cleared
  assert.equal(b, 500000);
});
