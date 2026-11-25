import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildUnlockPayload, formatUnlockToken, verifyUnlock } from './license-unlock';

const H = 'BM-AAAA-BBBB-CCCC-DDDD';

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mint with an ephemeral owner (same shape the desk script produces). */
function mint(priv: crypto.KeyObject, t: { hwid: string; counter: number; exp: number; scope: 'tamper' | 'drift' | 'emergency' }): string {
  const json = Buffer.from(JSON.stringify(t), 'utf8');
  const sig = crypto.sign(null, Buffer.from(buildUnlockPayload(t)), priv);
  return `UL-${b64url(json)}.${b64url(sig)}`;
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubRaw = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)).toString('hex');
const NOW = 1780000000000;
const good = mint(privateKey, { hwid: H, counter: 3, exp: NOW + 86400000, scope: 'tamper' });

describe('license-unlock ADR-050: offline codes', () => {
  it('accepts a genuine code for this machine', async () => {
    const v = await verifyUnlock(good, H, 2, NOW, pubRaw);
    assert.equal(v.ok, true);
    assert.equal(v.token?.scope, 'tamper');
  });
  it('refuses replays, wrong machines, and expired codes', async () => {
    assert.equal((await verifyUnlock(good, H, 3, NOW, pubRaw)).reason, 'REPLAY');
    assert.equal((await verifyUnlock(good, 'BM-FFFF-FFFF-FFFF-FFFF', 0, NOW, pubRaw)).reason, 'WRONG_MACHINE');
    assert.equal((await verifyUnlock(good, H, 0, NOW + 2 * 86400000, pubRaw)).reason, 'EXPIRED');
  });
  it('refuses tampered payloads and malformed tokens', async () => {
    assert.equal((await verifyUnlock('UL-!!!.AAA', H, 0, NOW, pubRaw)).reason, 'MALFORMED');
    const bad = mint(privateKey, { hwid: H, counter: 9, exp: NOW + 1, scope: 'drift' });
    const parts = bad.split('.');
    const tampered = `${parts[0].slice(0, -4)}AAAA.${parts[1]}`;
    assert.equal((await verifyUnlock(tampered, H, 0, NOW, pubRaw)).ok, false);
  });
  it('formatUnlockToken round-trips through verifyUnlock', async () => {
    const t = { hwid: H, counter: 5, exp: NOW + 86400000, scope: 'emergency' as const };
    const sig = b64url(crypto.sign(null, Buffer.from(buildUnlockPayload(t)), privateKey));
    const code = formatUnlockToken(t, sig);
    assert.match(code, /^UL-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/);
    const v = await verifyUnlock(code, H, 4, NOW, pubRaw);
    assert.equal(v.ok, true);
    assert.equal(v.token?.counter, 5);
  });
});
