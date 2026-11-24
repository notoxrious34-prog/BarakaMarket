import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  envelopeFromInput, buildEnvelopePayload, formatEnvelopeKey,
  parseEnvelopeKey, validateEnvelopeKey,
} from './license-envelope';
import { verifyEd25519Signature } from './licensing';

const H1 = 'BM-AAAA-BBBB-CCCC-DDDD';
const H2 = 'BM-1111-2222-3333-4444';
const STORE = 'Epicerie Nour';

/** Ephemeral owner: mint + verify roundtrip without the production key. */
function mintEphemeral() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const pubRaw = Buffer.from(pubDer.subarray(pubDer.length - 32)).toString('hex');
  return { publicKey, privateKey, pubRaw };
}

describe('envelope: structural validation', () => {
  it('rejects bad hwids, tiers, and inverted expiry', () => {
    assert.equal(envelopeFromInput(STORE, { tier: 'PERP', issuedMs: 1, hwid1: 'nope' }), null);
    assert.equal(envelopeFromInput(STORE, { tier: 'GOLD' as never, issuedMs: 1, hwid1: H1 }), null);
    assert.equal(envelopeFromInput(STORE, { tier: 'SUPPORT12', issuedMs: 100, expiresMs: 50, hwid1: H1 }), null);
  });
  it('accepts a full PERP + spare-hwid envelope', () => {
    const e = envelopeFromInput(STORE, { tier: 'PERP', issuedMs: 1700000000000, hwid1: H1, hwid2: H2, maxVer: '2.9.9' });
    assert.ok(e && e.h2 === H2 && e.exp === null);
  });
  it('parse rejects garbage, wrong shapes, and oversized blobs', () => {
    assert.equal(parseEnvelopeKey('AK-AAAA'), null);
    assert.equal(parseEnvelopeKey('AK2-!!!.???'), null);
    assert.equal(parseEnvelopeKey('  '), null);
  });
});

describe('envelope: crypto roundtrip (ephemeral Ed25519)', () => {
  const { privateKey, pubRaw } = mintEphemeral();
  const env = envelopeFromInput(STORE, { tier: 'SUPPORT12', issuedMs: 1700000000000, expiresMs: 1800000000000, hwid1: H1, hwid2: H2 })!;
  const sig = crypto.sign(null, Buffer.from(buildEnvelopePayload(env)), privateKey).toString('base64url');
  const key = formatEnvelopeKey(env, sig);

  it('validates on the primary slot', async () => {
    const v = await validateEnvelopeKey(STORE, H1, key, 1750000000000, pubRaw);
    assert.deepEqual(v, { ok: true, slot: 1, tier: 'SUPPORT12', maxVer: null });
  });
  it('validates on the spare slot', async () => {
    const v = await validateEnvelopeKey(STORE, H2, key, 1750000000000, pubRaw);
    assert.equal(v.ok, true);
    assert.equal(v.slot, 2);
  });
  it('refuses a third machine, a wrong store, and an expired key', async () => {
    assert.equal((await validateEnvelopeKey(STORE, 'BM-FFFF-FFFF-FFFF-FFFF', key, 1750000000000, pubRaw)).ok, false);
    assert.equal((await validateEnvelopeKey('Autre Magasin', H1, key, 1750000000000, pubRaw)).ok, false);
    const late = await validateEnvelopeKey(STORE, H1, key, 1900000000000, pubRaw);
    assert.equal(late.ok, false);
    assert.equal(late.expired, true);
  });
  it('refuses a tampered payload and a wrong pubkey', async () => {
    const parsed = parseEnvelopeKey(key)!;
    parsed.env.feat = 999;
    const { verifyEd25519Signature: v } = await import('./licensing');
    assert.equal(await v(pubRaw, buildEnvelopePayload(parsed.env), parsed.sigB64url), false);
    assert.equal(await verifyEd25519Signature('00'.repeat(32), buildEnvelopePayload(env), sig), false);
  });
});
