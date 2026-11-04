import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  validateSettlementAmount,
  reverseCreditOnVoid,
  validateCreditLimit,
  openingBalanceDzd,
  isValidNIF,
} from './client-debt';

describe('client-debt kernel (D-lane)', () => {
  it('D1: overpayment is refused', () => {
    assert.throws(() => validateSettlementAmount(5001, 5000), /exceeds/);
  });
  it('D1: zero / negative / NaN refused; exact balance accepted', () => {
    assert.throws(() => validateSettlementAmount(0, 5000), /positive/);
    assert.throws(() => validateSettlementAmount(-10, 5000), /positive/);
    assert.throws(() => validateSettlementAmount(NaN, 5000), /positive/);
    validateSettlementAmount(5000, 5000);
    validateSettlementAmount(1500.5, 5000);
  });
  it('D3: voiding a credit sale gives the debt back (floor 0)', () => {
    assert.strictEqual(reverseCreditOnVoid(4500, 1500), 3000);
    assert.strictEqual(reverseCreditOnVoid(1000, 1500), 0);
  });
  it('D7: negative ceiling refused; 0 = unlimited accepted', () => {
    assert.throws(() => validateCreditLimit(-5000), />= 0/);
    validateCreditLimit(0);
    validateCreditLimit(20000);
  });
  it('D6: NIF optional, 15 digits when present', () => {
    assert.strictEqual(isValidNIF(''), true);
    assert.strictEqual(isValidNIF('123456789012345'), true);
    assert.strictEqual(isValidNIF('1234567890123456'), false);
  });
  it('D12: statement reconciles via an explicit opening row', () => {
    // Karim: header 4500, ledger sees nothing yet → opening 4500.
    assert.strictEqual(openingBalanceDzd(4500, 0), 4500);
    // After one 1500 credit sale in-ledger: opening 3000, net 1500 → 4500.
    assert.strictEqual(openingBalanceDzd(4500, 1500), 3000);
  });
});
