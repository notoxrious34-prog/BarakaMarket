import test from 'node:test';
import assert from 'node:assert/strict';
import { openBarakaDb } from './sqlite.js';

type RawDb = {
  prepare: (s: string) => {
    get: (...a: unknown[]) => Record<string, unknown>;
    run: (...a: unknown[]) => void;
  };
};
const raw = (b: ReturnType<typeof openBarakaDb>): RawDb => (b as unknown as { db: RawDb }).db;

const seedClient = (
  b: ReturnType<typeof openBarakaDb>,
  id: number, balanceCt: number, maxCt: number, name = 'FAMILLE BENALI',
): void => {
  raw(b).prepare('INSERT INTO clients (id, name, phone, credit_balance_ct, max_credit_limit_ct) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, '0550123456', balanceCt, maxCt);
};

const row = (b: ReturnType<typeof openBarakaDb>, sql: string, ...args: unknown[]): Record<string, unknown> =>
  raw(b).prepare(sql).get(...args);

const count = (b: ReturnType<typeof openBarakaDb>, table: string): number =>
  Number(row(b, `SELECT COUNT(*) AS n FROM ${table}`).n);

test('settle: full 10,000 DZD payment zeroes balance with Art.136 timbre', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 1000000, 0);
  const out = b.settleClientCredit({ clientId: 1, amountCt: 1000000 });
  assert.equal(out.clientName, 'FAMILLE BENALI');
  assert.equal(out.previousBalanceCt, 1000000);
  assert.equal(out.newBalanceCt, 0);
  assert.equal(out.timbreCt, 10000);
  assert.equal(out.totalCollectedCt, 1010000);
  assert.equal(out.paymentMethod, 'ESPECES');
  assert.match(out.receiptNumber, /^Q-\d{4}-\d{6}$/);
  assert.equal(row(b, 'SELECT credit_balance_ct AS c FROM clients WHERE id = 1').c, 0);
  const s = row(b, 'SELECT * FROM client_settlements');
  assert.equal(s.amount_ct, 1000000);
  assert.equal(s.timbre_ct, 10000);
  assert.equal(s.total_collected_ct, 1010000);
  assert.equal(s.payment_method, 'ESPECES');
  b.close();
});

test('settle: partial 25,000 - 10,000 leaves 15,000 DZD (1,500,000ct)', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 2500000, 0);
  const out = b.settleClientCredit({ clientId: 1, amountCt: 1000000, cashierName: 'Yacine' });
  assert.equal(out.newBalanceCt, 1500000);
  assert.equal(out.cashierName, 'Yacine');
  assert.equal(row(b, 'SELECT credit_balance_ct AS c FROM clients WHERE id = 1').c, 1500000);
  b.close();
});

test('settle: CIB transfer carries no timbre', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 500000, 0);
  const out = b.settleClientCredit({ clientId: 1, amountCt: 500000, paymentMethod: 'CIB' });
  assert.equal(out.timbreCt, 0);
  assert.equal(out.totalCollectedCt, 500000);
  assert.equal(out.newBalanceCt, 0);
  b.close();
});

test('settle: quittance numbers are monotonic per year', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 2000000, 0);
  const a = b.settleClientCredit({ clientId: 1, amountCt: 100000 });
  const c = b.settleClientCredit({ clientId: 1, amountCt: 100000 });
  assert.notEqual(a.receiptNumber, c.receiptNumber);
  assert.ok(c.receiptNumber > a.receiptNumber);
  assert.notEqual(a.settlementId, c.settlementId);
  b.close();
});

test('settle: unknown client throws CLIENT_NOT_FOUND with zero side effects', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 500000, 0);
  assert.throws(() => b.settleClientCredit({ clientId: 77, amountCt: 100000 }), /CLIENT_NOT_FOUND/);
  assert.equal(count(b, 'client_settlements'), 0);
  assert.equal(row(b, 'SELECT credit_balance_ct AS c FROM clients WHERE id = 1').c, 500000);
  b.close();
});

test('settle: zero/negative amounts and bad methods rejected', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 500000, 0);
  assert.throws(() => b.settleClientCredit({ clientId: 1, amountCt: 0 }), /> 0/);
  assert.throws(() => b.settleClientCredit({ clientId: 1, amountCt: -500 }), /> 0/);
  assert.throws(() => b.settleClientCredit({
    clientId: 1, amountCt: 1000, paymentMethod: 'VIREMENT' as never,
  }), /ESPECES\|CIB/);
  assert.equal(count(b, 'client_settlements'), 0);
  b.close();
});

test('credit: limit breach denied with CREDIT_LIMIT_EXCEEDED', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 300000, 500000);
  const r = b.checkCreditEligibility(1, 400000);
  assert.equal(r.allowed, false);
  assert.equal(r.currentBalanceCt, 300000);
  assert.equal(r.maxCreditCt, 500000);
  assert.equal(r.projectedBalanceCt, 700000);
  assert.equal(r.reason, 'CREDIT_LIMIT_EXCEEDED');
  b.close();
});

test('credit: inside-limit and unlimited (0) ceilings allowed', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 300000, 500000);
  seedClient(b, 2, 9000000, 0, 'CANTINE ECOLE');
  const ok = b.checkCreditEligibility(1, 200000);
  assert.equal(ok.allowed, true);
  assert.equal(ok.projectedBalanceCt, 500000);
  assert.equal(ok.reason, undefined);
  const free = b.checkCreditEligibility(2, 400000);
  assert.equal(free.allowed, true);
  assert.throws(() => b.checkCreditEligibility(77, 1000), /CLIENT_NOT_FOUND/);
  b.close();
});

test('statement: client + settlements + credit sales', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 1000000, 0);
  b.settleClientCredit({ clientId: 1, amountCt: 400000 });
  const st = b.getClientStatement(1);
  assert.equal((st.client as { name: string }).name, 'FAMILLE BENALI');
  assert.equal(st.settlements.length, 1);
  assert.equal((st.settlements[0] as { amount_ct: number }).amount_ct, 400000);
  assert.deepEqual(st.creditSales, []);
  assert.throws(() => b.getClientStatement(77), /CLIENT_NOT_FOUND/);
  b.close();
});

test('settle: settlement survives and second client ledger isolated', () => {
  const b = openBarakaDb(':memory:');
  seedClient(b, 1, 1000000, 0);
  seedClient(b, 2, 800000, 0, 'VOISIN');
  b.settleClientCredit({ clientId: 2, amountCt: 800000 });
  assert.equal(row(b, 'SELECT credit_balance_ct AS c FROM clients WHERE id = 1').c, 1000000);
  assert.equal(row(b, 'SELECT credit_balance_ct AS c FROM clients WHERE id = 2').c, 0);
  assert.equal(count(b, 'client_settlements'), 1);
  b.close();
});
