#!/usr/bin/env tsx
/**
 * Baraka Market — standalone Owner keygen utility (TASK-BRK-016-MKT).
 * Single-click perpetual activation (5,000 DZD): prompts for store + HWID
 * (or takes argv), signs offline, re-verifies against the embedded public
 * seal, then prints a ready-to-send WhatsApp/SMS receipt. Zero typos leave
 * this script: an INVALID self-check aborts instead of printing the key.
 * STAFF ONLY — needs .baraka-privkey.pem or BARAKA_PRIVATE_KEY (never committed).
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
  const pemPath = path.resolve(process.cwd(), '.baraka-privkey.pem');
  if (fs.existsSync(pemPath)) return createPrivateKey(fs.readFileSync(pemPath, 'utf8'));
  console.error('Missing private key: set BARAKA_PRIVATE_KEY or save .baraka-privkey.pem (gitignored).');
  process.exit(1);
}

async function main() {
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
  const key = loadPrivateKey();
  const license = formatActivationKey(sign(null, buildLicensePayload(store, hwid), key).toString('base64url'));
  if (!(await validateLicense(store, hwid, license))) {
    console.error('SELF-CHECK FAILED — key does not verify against the public seal. Aborting.');
    process.exit(1);
  }
  console.log(`STORE: ${store}`);
  console.log(`HWID : ${hwid}`);
  console.log(`KEY  : ${license}`);
  console.log('CHECK: VALID');
  console.log('--- WhatsApp / SMS (copy below) ---');
  console.log(`سلام، مفتاح تفعيل Baraka Market لمحل "${store}": ${license} — الصقه في الإعدادات ← الترخيص ← تفعيل.`);
}

await main();
