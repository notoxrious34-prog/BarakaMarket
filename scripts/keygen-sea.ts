/**
 * BarakaKeygen v2 — owner activation desk (SEA single-executable).
 * Menu: generate → verify → history → quit. Same Ed25519 core as
 * scripts/keygen.ts, self-checking, offline. STAFF ONLY.
 *
 * v1 bug fixed: the old build waited on `process.stdin.once('data')`
 * AFTER `readline.close()` had paused stdin — empty event loop, instant
 * exit right after the HWID prompt. v2 keeps ONE persistent readline for
 * the whole session and closes it only on quit.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import {
  computeHwid, collectNodeFingerprint, buildLicensePayload,
  formatActivationKey, validateLicense, canonicalStoreName,
} from '../src/core/licensing.js';

const HWID_RE = /^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

function exeDir(): string {
  try {
    const d = path.dirname(process.execPath);
    if (!process.execPath.toLowerCase().includes('node')) return d;
  } catch { /* fall through */ }
  return process.cwd();
}

function loadPrivateKey() {
  if (process.env.BARAKA_PRIVATE_KEY) return createPrivateKey(process.env.BARAKA_PRIVATE_KEY);
  for (const dir of [exeDir(), process.cwd()]) {
    const pemPath = path.join(dir, '.baraka-privkey.pem');
    if (fs.existsSync(pemPath)) return createPrivateKey(fs.readFileSync(pemPath, 'utf8'));
  }
  console.error('Missing private key: put .baraka-privkey.pem NEXT TO BarakaKeygen.exe');
  console.error('(or run from the repo root, or set BARAKA_PRIVATE_KEY).');
  process.exit(1);
}

function historyPath(): string {
  return path.join(exeDir(), 'keygen-history.log');
}

function logIssued(store: string, hwid: string, license: string): void {
  try {
    fs.appendFileSync(historyPath(), `${new Date().toISOString()} | ${store} | ${hwid} | ${license}\n`);
  } catch { /* history is best-effort, never blocks issuance */ }
}

function printReceipt(store: string, hwid: string, license: string): void {
  console.log(`STORE: ${store}`);
  console.log(`HWID : ${hwid}`);
  console.log(`KEY  : ${license}`);
  console.log('CHECK: VALID');
  console.log('--- WhatsApp / SMS (copy below) ---');
  console.log(`سلام، مفتاح تفعيل Baraka Market لمحل "${store}": ${license} — الصقه في الإعدادات ← الترخيص ← تفعيل.`);
}

/**
 * Line reader that works on BOTH a real console (double-click) and piped
 * stdin. Node's readline/promises on Windows drops everything after the
 * first question when stdin is a pipe; this queue-based reader consumes
 * the stream uniformly, so scripted input and typed input behave the same.
 */
function createLineReader(input: NodeJS.ReadableStream) {
  let buf = '';
  let ended = false;
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  const drain = () => {
    while (lines.length > 0 && waiters.length > 0) {
      const w = waiters.shift() as (line: string) => void;
      w(lines.shift() as string);
    }
    if (ended) {
      let w: ((line: string) => void) | undefined;
      while ((w = waiters.shift())) w(buf);
      buf = '';
    }
  };
  const pump = () => {
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(buf.slice(0, i).replace(/\r$/, ''));
      buf = buf.slice(i + 1);
    }
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
        if (lines.length > 0) {
          res((lines.shift() as string).trim());
        } else if (ended) {
          const line = buf;
          buf = '';
          res(line.trim());
        } else {
          waiters.push(l => res(l.trim()));
          drain();
        }
      });
    },
  };
}

type Prompter = { ask(q: string): Promise<string> };

async function cmdGenerate(rl: Prompter | null, presetStore?: string, presetHwid?: string): Promise<void> {
  let store = presetStore ?? '';
  let hwid = presetHwid ?? '';
  if (!store || !hwid) {
    if (!rl) { console.error('Store + HWID required as arguments.'); return; }
    if (!store) {
      store = await rl.ask('Store name (as registered): ');
      if (!store) { console.error('Store name required.'); return; }
    }
    if (!hwid) {
      const local = computeHwid(collectNodeFingerprint(process.env.BARAKA_SEED ?? 'shop-pos-seed', os));
      hwid = (await rl.ask(`Shop HWID [Enter = this machine: ${local}]: `)) || local;
    }
  }
  const name = canonicalStoreName(store);
  const id = hwid.toUpperCase();
  if (!HWID_RE.test(id)) {
    console.error(`Invalid HWID — expected BM-XXXX-XXXX-XXXX-XXXX, got: ${hwid}`);
    return;
  }
  const license = formatActivationKey(sign(null, buildLicensePayload(name, id), loadPrivateKey()).toString('base64url'));
  if (!(await validateLicense(name, id, license))) {
    console.error('SELF-CHECK FAILED — key does not verify. Aborting.');
    return;
  }
  printReceipt(name, id, license);
  logIssued(name, id, license);
  console.log(`(logged → ${historyPath()})`);
}

async function cmdVerify(rl: Prompter): Promise<void> {
  const store = canonicalStoreName(await rl.ask('Store name: '));
  const hwid = (await rl.ask('HWID: ')).toUpperCase();
  const key = await rl.ask('Key (AK-…): ');
  if (!store || !HWID_RE.test(hwid) || !key) { console.log('VERIFY: INVALID (bad input)'); return; }
  console.log((await validateLicense(store, hwid, key)) ? 'VERIFY: VALID ✅' : 'VERIFY: INVALID ❌');
}

function cmdHistory(): void {
  try {
    const lines = fs.readFileSync(historyPath(), 'utf8').trim().split('\n');
    console.log(`--- history (${lines.length}) ---`);
    for (const l of lines.slice(-10)) console.log(l);
  } catch {
    console.log('(no history yet)');
  }
}

async function main(): Promise<void> {
  // Non-interactive shortcut: generate directly from argv (scripting/SSH).
  if (process.argv[2] && process.argv[3]) {
    await cmdGenerate(null, process.argv[2], process.argv[3]);
    return;
  }
  console.log('=== BarakaKeygen v2 — Owner activation desk ===');
  const rl = createLineReader(process.stdin);
    for (;;) {
      console.log('\n1) توليد مفتاح  2) تحقق  3) السجل  4) خروج');
      const choice = await rl.ask('> ');
      if (choice === '1') await cmdGenerate(rl);
      else if (choice === '2') await cmdVerify(rl);
      else if (choice === '3') cmdHistory();
      else if (choice === '4' || choice.toLowerCase() === 'q') break;
      else console.log('? 1-4');
    }
}

main();
