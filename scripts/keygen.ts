#!/usr/bin/env tsx
/**
 * BarakaDEV support keygen — air-gapped Ed25519 activation (ADR-002-MKT).
 * STAFF ONLY. The private key NEVER leaves the owner's machine:
 *   1. Save the production PEM (delivered out-of-band) as `.baraka-privkey.pem`
 *      in the repo root (gitignored), or export BARAKA_PRIVATE_KEY=<PEM>.
 *   2. npx tsx scripts/keygen.ts "Epicerie Nour" "BM-XXXX-XXXX-XXXX-XXXX"
 * Prints the AK key the shopkeeper pastes into Licence → Activation.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import {
  computeHwid, collectNodeFingerprint, buildLicensePayload,
  formatActivationKey, validateLicense, canonicalStoreName,
} from '../src/core/licensing.js';

function loadPrivateKey() {
  if (process.env.BARAKA_PRIVATE_KEY) return createPrivateKey(process.env.BARAKA_PRIVATE_KEY);
  const pemPath = path.resolve(process.cwd(), '.baraka-privkey.pem');
  if (fs.existsSync(pemPath)) return createPrivateKey(fs.readFileSync(pemPath, 'utf8'));
  console.error('Missing private key: set BARAKA_PRIVATE_KEY or save .baraka-privkey.pem (gitignored).');
  console.error('Ask the Master Principal Architect for the production PEM — it is NEVER committed.');
  process.exit(1);
}

const [, , storeName, hwidArg] = process.argv;

if (!storeName) {
  console.error('Usage: npx tsx scripts/keygen.ts "Store Name" ["BM-XXXX-..."]');
  console.error('  Without HWID: prints the HWID of THIS machine (run on the shop POS).');
  process.exit(1);
}

async function main() {
  const key = loadPrivateKey();
  let hwid: string;
  if (!hwidArg) {
    const seed = process.env.BARAKA_SEED ?? 'shop-pos-seed';
    hwid = computeHwid(collectNodeFingerprint(seed, os));
    console.log(`HWID(this machine, seed=${seed}): ${hwid}`);
  } else {
    hwid = hwidArg.trim().toUpperCase();
    if (!/^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(hwid)) {
      console.error('Invalid HWID format — expected BM-XXXX-XXXX-XXXX-XXXX');
      process.exit(1);
    }
  }
  const store = canonicalStoreName(storeName);
  const sig = sign(null, buildLicensePayload(store, hwid), key);
  const license = formatActivationKey(sig.toString('base64url'));
  console.log(`STORE: ${store}`);
  console.log(`HWID : ${hwid}`);
  console.log(`KEY  : ${license}`);
  console.log(`CHECK: ${(await validateLicense(store, hwid, license)) ? 'VALID' : 'INVALID'}`);
}

await main();
