#!/usr/bin/env tsx
/**
 * BarakaDEV support keygen — air-gapped activation over SMS/WhatsApp.
 * Usage: npx tsx scripts/keygen.ts "Epicerie Nour" "BM-XXXX-XXXX-XXXX-XXXX"
 * Prints the AK key the shopkeeper types into Licence → Activation.
 */
import os from 'node:os';
import { computeHwid, collectNodeFingerprint, generateActivationKey, validateLicense } from '../src/core/licensing.js';

const [, , storeName, hwidArg] = process.argv;

if (!storeName) {
  console.error('Usage: npx tsx scripts/keygen.ts "Store Name" ["BM-XXXX-..."]');
  console.error('  Without HWID: prints the HWID of THIS machine (run on the shop POS).');
  process.exit(1);
}

if (!hwidArg) {
  const seed = process.env.BARAKA_SEED ?? 'shop-pos-seed';
  const hwid = computeHwid(collectNodeFingerprint(seed, os));
  console.log(`HWID(this machine, seed=${seed}): ${hwid}`);
  console.log(`KEY : ${generateActivationKey(storeName, hwid)}`);
  process.exit(0);
}

const hwid = hwidArg.trim().toUpperCase();
if (!/^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(hwid)) {
  console.error('Invalid HWID format — expected BM-XXXX-XXXX-XXXX-XXXX');
  process.exit(1);
}
const key = generateActivationKey(storeName, hwid);
console.log(`STORE: ${storeName}`);
console.log(`HWID : ${hwid}`);
console.log(`KEY  : ${key}`);
console.log(`CHECK: ${validateLicense(storeName, hwid, key) ? 'VALID' : 'INVALID'}`);
