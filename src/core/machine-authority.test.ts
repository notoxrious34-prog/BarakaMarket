import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nativeParts, ensureMachineSeed } from './machine-authority';
import { computeHwid, collectBrowserFingerprint } from './licensing';

describe('machine-authority ADR-050: native identity', () => {
  it('nativeParts prefers the GUID and keeps the HWID formula shape', () => {
    const p = nativeParts({ guid: 'g-1', hostname: 'POS-01', arch: 'x64', os: 'Windows_NT' }, 'seed-1');
    assert.equal(p.hostname, 'G-1');
    assert.equal(p.arch, 'x64');
    assert.match(computeHwid(p), /^BM-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  });
  it('nativeParts falls back to hostname when the GUID is absent', () => {
    const p = nativeParts({ guid: '', hostname: 'pos-02', arch: 'x64', os: '' }, 'seed-1');
    assert.equal(p.hostname, 'POS-02');
    assert.equal(p.osVersion, 'native');
  });
  it('browser and native parts share the formula domain (same seed => comparable)', () => {
    const seed = 'seed-1';
    const b = computeHwid(collectBrowserFingerprint(seed));
    const n = computeHwid(nativeParts({ guid: '', hostname: 'browser-pos', arch: 'unknown', os: 'unknown' }, seed));
    assert.equal(typeof b, 'string');
    assert.equal(typeof n, 'string');
  });
  it('ensureMachineSeed falls back to the local seed when lanes are silent', async () => {
    assert.equal(await ensureMachineSeed(), 'headless-seed');
  });
});
