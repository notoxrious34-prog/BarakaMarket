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
import {
  canonicalizeHwid,
} from '../src/core/activation-desk.js';
import {
  envelopeFromInput, buildEnvelopePayload, formatEnvelopeKey, validateEnvelopeKey,
} from '../src/core/license-envelope.js';
import { resolveLedgerFile, recordLedgerEntry } from './ledger-cli.js';

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
  console.error('Ask the Master Principal Architect for the production PEM — it is NEVER committed.');
  process.exit(1);
}

const [, , storeName, hwidArg] = process.argv;

const LEDGER_FILE = resolveLedgerFile(process.argv);

/** Append a self-checked issuance to the shared ledger (F4: no silent minting). */
function recordLedger(entry: { store: string; hwid: string; key: string }): void {
  recordLedgerEntry(LEDGER_FILE, entry);
}

if (!storeName) {
  console.error('Usage: npx tsx scripts/keygen.ts "Store Name" ["BM-XXXX-..."|dash-less] [--format v1|v2] [--tier PERP|SUPPORT12] [--expires YYYY-MM-DD] [--max-ver X.Y.Z] [--hwid2 BM-…] [--ledger[=path]] [--no-ledger]');
  console.error('  Without HWID: prints the HWID of THIS machine (run on the shop POS).');
  console.error('  Ledger duty is ON by default (./keygen-ledger.jsonl); --no-ledger mints unrecorded (printed).');
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
    const canon = canonicalizeHwid(hwidArg);
    if (!canon) {
      console.error('Invalid HWID — expected BM-XXXX-XXXX-XXXX-XXXX (dashes optional, case-insensitive).');
      process.exit(1);
    }
    hwid = canon;
  }
  const store = canonicalStoreName(storeName);
  // ADR-050: v2 envelope by default (spare HWID, tiers, expiry, max-ver).
  // --format v1 keeps minting the legacy AK- key for grandfathered flows.
  const format = (flag('format') ?? 'v2').toLowerCase();
  if (format === 'v1') {
    const sig = sign(null, buildLicensePayload(store, hwid), key);
    const license = formatActivationKey(sig.toString('base64url'));
    console.log(`STORE: ${store}`);
    console.log(`HWID : ${hwid}`);
    console.log(`KEY  : ${license}`);
    const ok = await validateLicense(store, hwid, license);
    console.log(`CHECK: ${ok ? 'VALID' : 'INVALID'}`);
    if (!ok && LEDGER_FILE) {
      console.error('SELF-CHECK FAILED — refusing ledger append.');
      process.exit(3);
    }
    if (ok) recordLedger({ store, hwid, key: license });
    return;
  }
  const tierRaw = (flag('tier') ?? 'PERP').toUpperCase();
  if (tierRaw !== 'PERP' && tierRaw !== 'SUPPORT12') {
    console.error(`Invalid --tier "${flag('tier')}" — expected PERP or SUPPORT12.`);
    process.exit(1);
  }
  const expRaw = flag('expires');
  let expiresMs: number | null = null;
  if (expRaw) {
    const parsed = Date.parse(`${expRaw}T23:59:59Z`);
    if (!Number.isInteger(parsed) || parsed <= Date.now()) {
      console.error(`Invalid --expires "${expRaw}" — must be a future date (YYYY-MM-DD).`);
      process.exit(1);
    }
    expiresMs = parsed;
  }
  const maxVerRaw = flag('max-ver') ?? null;
  if (maxVerRaw !== null && !/^\d+\.\d+\.\d+$/.test(maxVerRaw)) {
    console.error(`Invalid --max-ver "${maxVerRaw}" — expected X.Y.Z (e.g. 1.10.0).`);
    process.exit(1);
  }
  const env = envelopeFromInput(store, {
    tier: tierRaw as 'PERP' | 'SUPPORT12', issuedMs: Date.now(),
    expiresMs, maxVer: maxVerRaw,
    hwid1: hwid,
    hwid2: flag('hwid2') ?? null,
  });
  if (!env) {
    console.error('Invalid envelope input (tier/expiry/hwid2) — see ADR-050.');
    process.exit(1);
  }
  const esig = sign(null, Buffer.from(buildEnvelopePayload(env)), key).toString('base64url');
  const elicense = formatEnvelopeKey(env, esig);
  console.log(`STORE: ${store}`);
  console.log(`HWID : ${hwid}${env.h2 ? ` (spare ${env.h2})` : ''}`);
  console.log(`TIER : ${env.tier}${env.exp ? ` until ${new Date(env.exp).toISOString().slice(0, 10)}` : ''}`);
  console.log(`KEY  : ${elicense}`);
  const vok = (await validateEnvelopeKey(store, hwid, elicense, Date.now())).ok;
  console.log(`CHECK: ${vok ? 'VALID' : 'INVALID'}`);
  if (!vok && LEDGER_FILE) {
    console.error('SELF-CHECK FAILED — refusing ledger append.');
    process.exit(3);
  }
  if (vok) recordLedger({ store, hwid, key: elicense });
}

await main();
