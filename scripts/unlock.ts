#!/usr/bin/env tsx
/**
 * BarakaDEV support — offline unlock-code minting (ADR-050 P3). STAFF ONLY.
 * The private key NEVER leaves the owner's machine (same loading as keygen).
 *   npx tsx scripts/unlock.ts --hwid BM-XXXX-... --counter 3 --days 2 --scope tamper
 * Counter MUST exceed the shop's last consumed counter (ask the shopkeeper for
 * the number shown under Licence → Unlock, or use a strictly higher one).
 */
import { createPrivateKey, sign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildUnlockPayload, type UnlockScope } from '../src/core/license-unlock.js';
import { verifyUnlock } from '../src/core/license-unlock.js';

function flag(name: string): string | undefined {
  const i = process.argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = process.argv[i];
  if (a.includes('=')) return a.slice(name.length + 3);
  return process.argv[i + 1];
}

function loadPrivateKey() {
  if (process.env.BARAKA_PRIVATE_KEY) return createPrivateKey(process.env.BARAKA_PRIVATE_KEY);
  const pemPath = path.resolve(process.cwd(), '.baraka-privkey.pem');
  if (fs.existsSync(pemPath)) return createPrivateKey(fs.readFileSync(pemPath, 'utf8'));
  console.error('Missing private key: set BARAKA_PRIVATE_KEY or save .baraka-privkey.pem (gitignored).');
  process.exit(1);
}

const HWID_RE = /^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

async function main() {
  const key = await loadPrivateKey();
  const hwid = (flag('hwid') ?? '').trim().toUpperCase();
  const counter = parseInt(flag('counter') ?? '', 10);
  const days = Math.min(7, Math.max(1, parseInt(flag('days') ?? '2', 10)));
  const scope = (flag('scope') ?? 'emergency') as UnlockScope;
  if (!HWID_RE.test(hwid) || !Number.isInteger(counter) || counter <= 0
    || (scope !== 'tamper' && scope !== 'drift' && scope !== 'emergency')) {
    console.error('Usage: npx tsx scripts/unlock.ts --hwid BM-XXXX-... --counter N --days 1..7 --scope tamper|drift|emergency');
    process.exit(1);
  }
  const token = { hwid, counter, exp: Date.now() + days * 86400000, scope };
  const b64 = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const json = b64(Buffer.from(JSON.stringify(token), 'utf8'));
  const sig = b64(sign(null, Buffer.from(buildUnlockPayload(token)), key as never));
  const code = `UL-${json}.${sig}`;
  console.log(`SCOPE  : ${scope} (counter ${counter}, ${days}d)`);
  console.log(`CODE   : ${code}`);
  console.log(`CHECK  : ${((await verifyUnlock(code, hwid, counter - 1, Date.now())).ok) ? 'VALID' : 'INVALID'}`);
}

await main();
