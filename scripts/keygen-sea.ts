/**
 * BarakaKeygen — owner activation tool (SEA single-executable build).
 * Same signing core as scripts/keygen.ts (Ed25519, offline, self-checking).
 * STAFF ONLY — reads .baraka-privkey.pem NEXT TO THE EXE (or BARAKA_PRIVATE_KEY).
 * Console wizard: double-click → prompts → prints key + WhatsApp receipt.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { createPrivateKey, sign } from 'node:crypto';
import {
  computeHwid, collectNodeFingerprint, buildLicensePayload,
  formatActivationKey, validateLicense, canonicalStoreName,
} from '../src/core/licensing.js';

const HWID_RE = /^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

function loadPrivateKey() {
  if (process.env.BARAKA_PRIVATE_KEY) return createPrivateKey(process.env.BARAKA_PRIVATE_KEY);
  const pemPath = path.join(path.dirname(process.execPath), '.baraka-privkey.pem');
  if (fs.existsSync(pemPath)) return createPrivateKey(fs.readFileSync(pemPath, 'utf8'));
  const cwdPem = path.resolve(process.cwd(), '.baraka-privkey.pem');
  if (fs.existsSync(cwdPem)) return createPrivateKey(fs.readFileSync(cwdPem, 'utf8'));
  console.error('Missing private key: put .baraka-privkey.pem NEXT TO BarakaKeygen.exe');
  console.error('(or run from the repo root, or set BARAKA_PRIVATE_KEY).');
  process.exit(1);
}

async function main() {
  console.log('=== BarakaKeygen — Owner activation tool ===');
  let [, , storeArg, hwidArg] = process.argv;
  if (!storeArg || !hwidArg) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      storeArg ??= (await rl.question('Store name (as registered): ')).trim();
      if (!storeArg) { console.error('Store name required.'); process.exit(1); }
      const local = computeHwid(collectNodeFingerprint(process.env.BARAKA_SEED ?? 'shop-pos-seed', os));
      hwidArg ??= (await rl.question(`Shop HWID [Enter = this machine: ${local}]: `)).trim() || local;
    } finally { rl.close(); }
  }
  const store = canonicalStoreName(storeArg);
  const hwid = hwidArg.trim().toUpperCase();
  if (!HWID_RE.test(hwid)) {
    console.error(`Invalid HWID — expected BM-XXXX-XXXX-XXXX-XXXX, got: ${hwid}`);
    process.exit(1);
  }
  const license = formatActivationKey(sign(null, buildLicensePayload(store, hwid), loadPrivateKey()).toString('base64url'));
  if (!(await validateLicense(store, hwid, license))) {
    console.error('SELF-CHECK FAILED — key does not verify. Aborting.');
    process.exit(1);
  }
  console.log(`STORE: ${store}`);
  console.log(`HWID : ${hwid}`);
  console.log(`KEY  : ${license}`);
  console.log('CHECK: VALID');
  console.log('--- WhatsApp / SMS (copy below) ---');
  console.log(`سلام، مفتاح تفعيل Baraka Market لمحل "${store}": ${license} — الصقه في الإعدادات ← الترخيص ← تفعيل.`);
  if (!process.argv[2]) {
    console.log('(Press Enter to close)');
    await new Promise<void>(res => process.stdin.once('data', () => res()));
  }
}

main();
