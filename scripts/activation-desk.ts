#!/usr/bin/env tsx
/**
 * Baraka Activation Desk v3 — owner license station (SEA single-executable).
 * Crypto FROZEN (ADR-002): Ed25519 `AK-…` minted here, verified by clients
 * against the embedded public key. This tool is STAFF ONLY — the private key
 * NEVER ships: `.baraka-privkey.pem` next to the exe, repo root, or env.
 *
 *   generate --store "Epicerie Nour" --hwid BM-… [--json] [--yes] [--key-file p.pem]
 *   verify   --store S --hwid H --key AK-… [--json]
 *   hwid [--seed s] [--json]      # this machine's fingerprint (phone support)
 *   ledger [--verify] [--csv] [--last N] [--revoke SEQ]
 *
 * Exit codes: 0 ok · 2 usage/input · 3 crypto/self-check/refusal.
 * Non-TTY without full flags fails fast (never hangs waiting for a human).
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import {
  computeHwid, collectNodeFingerprint, buildLicensePayload,
  formatActivationKey, validateLicense, canonicalStoreName, LICENSE_PRICE_DZD,
} from '../src/core/licensing.js';
import {
  canonicalizeHwid, parseDeskArgs, ledgerAppend, ledgerVerify, ledgerParse,
  renderReceipt, DESK_VERSION, type LedgerEntry,
} from '../src/core/activation-desk.js';

class DeskError extends Error {
  code: number;
  constructor(code: number, msg: string) { super(msg); this.code = code; }
}
const fail = (code: number, msg: string): never => { throw new DeskError(code, msg); };

function exeDir(): string {
  try {
    const d = path.dirname(process.execPath);
    if (!process.execPath.toLowerCase().includes('node')) return d;
  } catch { /* fall through */ }
  return process.cwd();
}

function loadPrivateKey(explicit?: string): ReturnType<typeof createPrivateKey> {
  if (explicit) {
    if (!fs.existsSync(explicit)) fail(2, `key file not found: ${explicit}`);
    return createPrivateKey(fs.readFileSync(explicit, 'utf8'));
  }
  if (process.env.BARAKA_PRIVATE_KEY) return createPrivateKey(process.env.BARAKA_PRIVATE_KEY);
  for (const dir of [exeDir(), process.cwd()]) {
    const p = path.join(dir, '.baraka-privkey.pem');
    if (fs.existsSync(p)) return createPrivateKey(fs.readFileSync(p, 'utf8'));
  }
  throw new DeskError(2, 'Missing private key: --key-file <pem>, .baraka-privkey.pem next to the exe, or BARAKA_PRIVATE_KEY.');
}

const ledgerPath = (): string => path.join(exeDir(), 'keygen-ledger.jsonl');

function readLedger(): LedgerEntry[] {
  try {
    return ledgerParse(fs.readFileSync(ledgerPath(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Proven queue reader (v2): uniform on console + pipes; never hangs, never drops. */
function createLineReader(input: NodeJS.ReadableStream) {
  let buf = '';
  let ended = false;
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  const drain = () => {
    while (lines.length > 0 && waiters.length > 0) (waiters.shift() as (l: string) => void)(lines.shift() as string);
    if (ended) { let w: ((l: string) => void) | undefined; while ((w = waiters.shift())) w(buf); buf = ''; }
  };
  const pump = () => {
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
    drain();
  };
  input.setEncoding('utf8');
  input.on('data', (c: string) => { buf += c; pump(); });
  input.on('end', () => { ended = true; pump(); });
  input.on('close', () => { ended = true; pump(); });
  return {
    ask(q: string): Promise<string> {
      process.stdout.write(q);
      return new Promise<string>(res => {
        if (lines.length > 0) res((lines.shift() as string).trim());
        else if (ended) { const l = buf; buf = ''; res(l.trim()); }
        else { waiters.push(l => res(l.trim())); drain(); }
      });
    },
  };
}
type Prompter = { ask(q: string): Promise<string> };
const TTY = !!process.stdin.isTTY;

async function cmdGenerate(o: { store?: string; hwid?: string; json: boolean; yes: boolean; keyFile?: string }, rl: Prompter | null): Promise<void> {
  let store = o.store ?? '';
  let hwidRaw = o.hwid ?? '';
  if (!store || !hwidRaw) {
    if (!rl || !TTY) fail(2, 'Non-interactive: generate requires --store "..." --hwid BM-…');
    if (!store) store = await (rl as Prompter).ask('Store name (as registered): ');
    if (!hwidRaw) {
      const local = computeHwid(collectNodeFingerprint(process.env.BARAKA_SEED ?? 'shop-pos-seed', os));
      hwidRaw = (await (rl as Prompter).ask(`Shop HWID [Enter = this machine: ${local}]: `)) || local;
    }
  }
  if (!store.trim()) fail(2, 'Store name required.');
  const hwid = canonicalizeHwid(hwidRaw);
  if (!hwid) fail(2, `Invalid HWID ${JSON.stringify(hwidRaw)} — expected BM-XXXX-XXXX-XXXX-XXXX (dashes optional, case-insensitive).`);
  const name = canonicalStoreName(store);
  if (!o.yes && rl && TTY && !o.json) {
    console.log(`Will sign  STORE=${name}  HWID=${hwid}`);
    const ok = await rl.ask('Sign? [yes/NO]: ');
    if (!/^y(es)?$/i.test(ok)) fail(3, 'Refused by operator — nothing signed.');
  }
  const key = loadPrivateKey(o.keyFile);
  const license = formatActivationKey(sign(null, buildLicensePayload(name, hwid as string), key).toString('base64url'));
  if (!(await validateLicense(name, hwid as string, license))) fail(3, 'SELF-CHECK FAILED — key does not verify. Aborting.');
  const prev = readLedger();
  const entry = ledgerAppend(prev, { ts: new Date().toISOString(), kind: 'issue', store: name, hwid: hwid as string, key: license });
  try {
    fs.appendFileSync(ledgerPath(), `${JSON.stringify(entry)}\n`);
  } catch { /* ledger best-effort; the key itself already verified */ }
  if (o.json) {
    console.log(JSON.stringify({ store: name, hwid, key: license, seq: entry.seq, valid: true }));
  } else {
    console.log(renderReceipt(name, hwid as string, license, entry.seq, LICENSE_PRICE_DZD));
    console.log(`(ledger #${entry.seq} → ${ledgerPath()})`);
  }
}

async function cmdVerify(o: { store?: string; hwid?: string; key?: string; json: boolean }, rl: Prompter | null): Promise<void> {
  let { store = '', hwid: hwidRaw = '', key = '' } = o;
  if (!store || !hwidRaw || !key) {
    if (!rl || !TTY) fail(2, 'Non-interactive: verify requires --store --hwid --key.');
    if (!store) store = canonicalStoreName(await (rl as Prompter).ask('Store name: '));
    if (!hwidRaw) hwidRaw = await (rl as Prompter).ask('HWID: ');
    if (!key) key = await (rl as Prompter).ask('Key (AK-…): ');
  }
  const hwid = canonicalizeHwid(hwidRaw);
  const valid = !!hwid && (await validateLicense(store, hwid, key.trim()));
  if (o.json) console.log(JSON.stringify({ store: canonicalStoreName(store), hwid, valid }));
  else console.log(valid ? 'VERIFY: VALID ✅' : 'VERIFY: INVALID ❌');
  if (!valid) process.exit(3);
}

function cmdHwid(seed?: string, json?: boolean): void {
  const hwid = computeHwid(collectNodeFingerprint(seed ?? process.env.BARAKA_SEED ?? 'shop-pos-seed', os));
  if (json) console.log(JSON.stringify({ hwid }));
  else console.log(`HWID(this machine): ${hwid}`);
}

function cmdLedger(o: { verify: boolean; csv: boolean; last: number; revoke: number | null }): void {
  let entries = readLedger();
  if (o.revoke !== null) {
    const target = entries.find(e => e.seq === o.revoke && e.kind === 'issue') ?? fail(2, `No issuance #${o.revoke} to revoke.`);
    const mark = ledgerAppend(entries, { ts: new Date().toISOString(), kind: 'revoke', store: target.store, hwid: target.hwid, key: target.key, note: `revoked by operator (staff-side reference; clients verify offline)` });
    fs.appendFileSync(ledgerPath(), `${JSON.stringify(mark)}\n`);
    entries = [...entries, mark];
    console.log(`Revocation marker appended (#${mark.seq} → revokes #${o.revoke}). Note: shipped clients verify offline — treat the key as compromised and rotate the shop to a new HWID.`);
  }
  const v = ledgerVerify(entries);
  if (o.verify) {
    console.log(v.brokenAt === null ? `LEDGER: INTACT ✅ (${v.count} entries)` : `LEDGER: TAMPERED ❌ (first break at #${v.brokenAt})`);
    if (v.brokenAt !== null) process.exit(3);
    return;
  }
  if (o.csv) {
    console.log('seq,ts,kind,store,hwid,price_dzd');
    for (const e of entries.slice(-o.last)) console.log(`${e.seq},${e.ts},${e.kind},"${e.store}",${e.hwid},${e.kind === 'issue' ? LICENSE_PRICE_DZD : 0}`);
    return;
  }
  console.log(`--- ledger (${entries.length} entries, chain ${v.brokenAt === null ? 'INTACT ✅' : `BROKEN at #${v.brokenAt} ❌`}) ---`);
  for (const e of entries.slice(-o.last)) console.log(`#${e.seq} ${e.ts} [${e.kind}] ${e.store} ${e.hwid} ${e.hash.slice(0, 12)}…`);
}

const HELP = `Baraka Activation Desk v${DESK_VERSION} — STAFF ONLY (private key never ships).

  generate --store "S" --hwid BM-… [--json] [--yes] [--key-file p.pem]
  verify   --store S --hwid H --key AK-… [--json]
  hwid [--seed s] [--json]
  ledger [--verify] [--csv] [--last N] [--revoke SEQ]

Interactive (TTY): missing values are prompted with sane defaults.
Bare launch on a console opens the guided menu; piped bare launch prints help.
Non-TTY: all values required as flags — fails fast, never hangs.
Exit: 0 ok · 2 usage/input · 3 crypto/self-check/refusal/tamper.`;

async function cmdMenu(rl: Prompter): Promise<void> {
  console.log(`=== Baraka Activation Desk v${DESK_VERSION} — STAFF ONLY ===`);
  for (;;) {
    console.log('\n1) توليد مفتاح  2) تحقق  3) السجل  4) HWID هذا الجهاز  5) خروج');
    const choice = await rl.ask('> ');
    if (choice === '1') await cmdGenerate({ json: false, yes: false }, rl);
    else if (choice === '2') await cmdVerify({ json: false }, rl);
    else if (choice === '3') cmdLedger({ verify: false, csv: false, last: 10, revoke: null });
    else if (choice === '4') cmdHwid();
    else if (choice === '5' || choice.toLowerCase() === 'q') break;
    else console.log('? 1-5');
  }
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  // Double-click ergonomics: a bare TTY launch opens the guided menu
  // (a help dump would flash and vanish). Pipes/scripts get help.
  if (raw.length === 0 && TTY) {
    const rl = createLineReader(process.stdin);
    try {
      await cmdMenu(rl);
    } catch (e) {
      if (e instanceof DeskError) { console.error(e.message); process.exitCode = e.code; }
      else { console.error(`Unexpected: ${(e as Error)?.message ?? e}`); process.exitCode = 3; }
    } finally {
      try { (process.stdin as unknown as { pause?: () => void }).pause?.(); } catch { /* noop */ }
      process.exit(process.exitCode ?? 0);
    }
    return;
  }
  const cmd = parseDeskArgs(raw);
  const rl = cmd.name === 'generate' || cmd.name === 'verify' ? createLineReader(process.stdin) : null;
  try {
    switch (cmd.name) {
      case 'generate': await cmdGenerate(cmd, rl); break;
      case 'verify': await cmdVerify(cmd, rl); break;
      case 'hwid': cmdHwid(cmd.seed, cmd.json); break;
      case 'ledger': cmdLedger(cmd); break;
      case 'version': console.log(`activation-desk ${DESK_VERSION}`); break;
      default: console.log(HELP); break;
    }
  } catch (e) {
    if (e instanceof DeskError) {
      console.error(e.message);
      process.exitCode = e.code;
    } else {
      console.error(`Unexpected: ${(e as Error)?.message ?? e}`);
      process.exitCode = 3;
    }
  } finally {
    try { (process.stdin as unknown as { pause?: () => void }).pause?.(); } catch { /* noop */ }
    process.exit(process.exitCode ?? 0);
  }
}

main();
