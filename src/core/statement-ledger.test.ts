/**
 * C2: ledger builder — chrono sort, running balance, timbre never reduces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatementRows } from './statement-ledger.js';

const L = { credit: 'Achat', settlement: (m: string) => `Versement ${m}` };

test('C2: purchases then payments net to the running remainder', () => {
  const rows = buildStatementRows(
    [{ created_at: '2026-11-01', ticket_number: 'T-1', total_ttc: 1000 }],
    [{ date: '2026-11-02', payment_method: 'ESPECES', id: 'abc123', amount: 400 }],
    L,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].balanceCt, 100000);
  assert.equal(rows[1].balanceCt, 60000);
  assert.equal(rows[1].creditCt, 40000);
});

test('C2: out-of-order events sort chronologically', () => {
  const rows = buildStatementRows(
    [{ created_at: '2026-11-05', ticket_number: 'T-2', total_ttc: 500 }],
    [{ date: '2026-11-01', payment_method: 'CIB', id: 'x', amount: 200 }],
    L,
  );
  assert.ok(rows[0].date < rows[1].date);
  assert.equal(rows[1].balanceCt, 30000);
});

test('C2: empty ledger, overpayment goes negative (credit to client)', () => {
  assert.deepEqual(buildStatementRows([], [], L), []);
  const rows = buildStatementRows([], [{ date: '2026-11-01', payment_method: 'ESPECES', id: 'z', amount: 100 }], L);
  assert.equal(rows[0].balanceCt, -10000);
});
