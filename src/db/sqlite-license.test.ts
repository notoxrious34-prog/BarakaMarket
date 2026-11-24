import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openBarakaDb, verifyLicenseSignatureSync } from './sqlite.js';
import { calculateLineTotalsCt, calculateSaleTotalsCt } from '../core/fiscal.centimes.js';
import {
  TRIAL_EPOCH_META_KEY, LICENSE_GATE_META_KEY, LICENSE_OVERRIDE_META_KEY,
} from '../core/license-gate.js';

/** Minimal valid ESPECES sale (ghost product commits flagged — v1.8.3). */
function ghostArgs(tag: string) {
  const line = calculateLineTotalsCt(18000, 2, 0);
  const t = calculateSaleTotalsCt([{ tva_rate: 0 as const, ...line }], 'ESPECES');
  return {
    header: {
      id: tag, cashier_id: 'C-1', cashier_name: 'Amine', payment_method: 'ESPECES' as const,
      amount_paid_ct: t.total_ttc_ct, amount_returned_ct: 0, totals: t,
      created_at: '2026-11-24T10:00:00.000Z',
    },
    items: [
      { product_id: 424242, barcode: 'x', name_fr: 'GHOST', name_ar: '', unit_price_ct: 18000, qty_milli: 2000, unit: 'PIECE' as const, tva_rate: 0 as const, discount_bp: 0, line_ht_ct: line.total_line_ht_ct, line_tva_ct: line.total_line_tva_ct, line_ttc_ct: line.total_line_ttc_ct },
    ],
  };
}

test('db ADR-050: fresh lane stamps trial_epoch and commits (grandfather)', () => {
  const b = openBarakaDb(':memory:');
  const s = ghostArgs('p2-g1');
  const out = b.recordSale(s.header, s.items);
  assert.match(out.invoice_number, /^FACT-/);
  assert.ok(b.getMeta(TRIAL_EPOCH_META_KEY));
  b.close();
});

test('db ADR-050: exhausted trial (50 sales + 15 days) refuses LICENSE_TRIAL_EXPIRED', () => {
  const b = openBarakaDb(':memory:');
  b.setMeta(TRIAL_EPOCH_META_KEY, String(Date.now() - 15 * 86400000));
  for (let i = 0; i < 50; i++) {
    const s = ghostArgs(`p2-fill-${i}`);
    b.recordSale(s.header, s.items);
  }
  // The 51st sale: both budgets exhausted (50 sales AND 15 days).
  // NOTE: count includes... each recordSale above committed (trial alive by days? no — epoch 15d ago, count<50 until the 50th). The 51st must refuse.
  const s = ghostArgs('p2-over');
  assert.throws(() => b.recordSale(s.header, s.items), /LICENSE_TRIAL_EXPIRED/);
  b.close();
});

test('db ADR-050: forged ACTIVATED record refuses LICENSE_KEY_INVALID', () => {
  const b = openBarakaDb(':memory:');
  b.setMeta('license_state', JSON.stringify({
    status: 'ACTIVATED', storeName: 'NOUR', key: `AK-${'A'.repeat(86)}`, hwid: 'BM-AAAA-BBBB-CCCC-DDDD',
  }));
  const s = ghostArgs('p2-forge');
  assert.throws(() => b.recordSale(s.header, s.items), /LICENSE_KEY_INVALID/);
  b.close();
});

test('db ADR-050: published gate deny locks the lane (LICENSE_DENIED)', () => {
  const b = openBarakaDb(':memory:');
  b.setMeta(LICENSE_GATE_META_KEY, JSON.stringify({ ok: false, at: Date.now() }));
  const s = ghostArgs('p2-gate');
  assert.throws(() => b.recordSale(s.header, s.items), /LICENSE_DENIED/);
  b.close();
});
test('db ADR-050: published gate deny carries its reason', () => {
  const b = openBarakaDb(':memory:');
  b.setMeta(LICENSE_GATE_META_KEY, JSON.stringify({ ok: false, reason: 'LICENSE_KEY_INVALID' }));
  const s = ghostArgs('p2-gate-reason');
  assert.throws(() => b.recordSale(s.header, s.items), /LICENSE_KEY_INVALID/);
  b.close();
});

test('db ADR-050: owner override unlocks an exhausted trial', () => {
  const b = openBarakaDb(':memory:');
  b.setMeta(TRIAL_EPOCH_META_KEY, String(Date.now() - 15 * 86400000));
  for (let i = 0; i < 50; i++) {
    const s = ghostArgs(`p2-ovf-${i}`);
    b.recordSale(s.header, s.items);
  }
  b.setMeta(LICENSE_OVERRIDE_META_KEY, String(Date.now() + 3600000));
  const s = ghostArgs('p2-ov-ok');
  assert.match(b.recordSale(s.header, s.items).invoice_number, /^FACT-/);
  b.close();
});

test('db ADR-050: sync signature verifies a genuine key, rejects tampering', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubRaw = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)).toString('hex');
  const store = 'EPICERIE NOUR';
  const hwid = 'BM-AAAA-BBBB-CCCC-DDDD';
  const sig = crypto.sign(null, Buffer.from(`${store}||${hwid}`, 'utf8'), privateKey).toString('base64url');
  const key = `AK-${sig}`;
  assert.equal(verifyLicenseSignatureSync(store, hwid, key, pubRaw), true);
  assert.equal(verifyLicenseSignatureSync(store, 'BM-FFFF-FFFF-FFFF-FFFF', key, pubRaw), false);
  assert.equal(verifyLicenseSignatureSync(store, hwid, `AK-${'B'.repeat(86)}`, pubRaw), false);
});
