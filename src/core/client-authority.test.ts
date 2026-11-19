import assert from 'node:assert';
import { describe, it } from 'node:test';
import { toMirrorClient, syncClientsMirror } from './client-authority.js';
import type { Client } from '../types/index.js';

const cli = (over: Partial<Client> = {}): Client => ({
  id: 9, name: 'Test 1', phone: '055', address: '', credit_balance: 0,
  max_credit_limit: 0, ...over,
});

describe('client-authority (F4 v1.8.4)', () => {
  it('maps UI client to lane centimes, balance never crosses', () => {
    const m = toMirrorClient(cli({ max_credit_limit: 5000, credit_balance: 370 }));
    assert.equal(m.id, 9);
    assert.equal(m.name, 'Test 1');
    assert.equal(m.max_credit_limit_ct, 500000);
    assert.ok(!('credit_balance_ct' in m), 'ledger balance must never cross to the lane');
  });

  it('sync skips Passager and no-ops every row outside Tauri (this runner)', async () => {
    const r = await syncClientsMirror([cli({ id: 1 }), cli()]);
    assert.equal(r.synced, 0, 'no Tauri shell here — lane untouched');
    assert.equal(r.failed, 1, 'only the non-Passager row attempted');
  });
});
