import { describe, it } from 'node:test';
import assert from 'node:assert';
import { nextBRNumber, validateReceptionPayment, validateSupplierPayment, isValidNIF, SeqStorage } from './supplier-finance.js';

const mem = (init: Record<string, string> = {}): SeqStorage => {
  const m = new Map(Object.entries(init));
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};

describe('supplier-finance: M1 monotonic BR numbers', () => {
  it('seeds from existing then stays monotonic across deletes', () => {
    const s = mem();
    assert.equal(nextBRNumber(s, 2026, ['BR-2026-0001', 'BR-2026-0002']), 'BR-2026-0003');
    // delete BR-2026-0003 happened (not in existing) — counter still advances
    assert.equal(nextBRNumber(s, 2026, ['BR-2026-0001', 'BR-2026-0002']), 'BR-2026-0004');
  });
  it('starts at 0001 on a clean shop and ignores other years', () => {
    const s = mem();
    assert.equal(nextBRNumber(s, 2026, ['BR-2025-0041']), 'BR-2026-0001');
  });
});

describe('supplier-finance: M4 payment guards', () => {
  it('reception refuses overpayment, accepts exact and partial', () => {
    assert.throws(() => validateReceptionPayment(1000, 1000.01), /overpayment/);
    validateReceptionPayment(1000, 1000);
    validateReceptionPayment(1000, 0);
    assert.throws(() => validateReceptionPayment(1000, -1), />= 0/);
  });
  it('settlement refuses overpayment and non-positive amounts', () => {
    assert.throws(() => validateSupplierPayment(500, 500.01), /overpayment/);
    validateSupplierPayment(500, 500);
    assert.throws(() => validateSupplierPayment(500, 0), /> 0/);
    assert.throws(() => validateSupplierPayment(-1, 10), /bad balance/);
  });
});

describe('supplier-finance: M7 NIF', () => {
  it('accepts empty, requires exactly 15 digits', () => {
    assert.equal(isValidNIF(''), true);
    assert.equal(isValidNIF('000216001234567'), true);
    assert.equal(isValidNIF('123'), false);
    assert.equal(isValidNIF('00021600123456A'), false);
    assert.equal(isValidNIF('0002160012345678'), false);
  });
});
