#!/usr/bin/env tsx
/**
 * Shared CLI ledger duty (staff issuance scripts).
 * Any script that mints a key MUST record it here — no silent minting (F4).
 * Cross-process file lock: a CLI append never interleaves with the running
 * desk station (which holds its own in-process mutex). Stale locks (>60s)
 * are stolen; a live holder fails fast after 10s with guidance.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ledgerAppend, ledgerVerify, ledgerParse, type LedgerEntry,
} from '../src/core/activation-desk.js';

/**
 * Resolve the ledger file from argv. Ledger duty is ON by default
 * (./keygen-ledger.jsonl); pass `--no-ledger` for an explicitly unrecorded
 * mint (printed as skipped), or `--ledger[=path]` to redirect.
 */
export function resolveLedgerFile(argv: string[]): string | null {
  if (argv.includes('--no-ledger')) return null;
  const i = argv.findIndex(a => a === '--ledger' || a.startsWith('--ledger='));
  if (i < 0) return path.resolve(process.cwd(), 'keygen-ledger.jsonl');
  const a = argv[i];
  const v = a.includes('=') ? a.slice('--ledger='.length) : argv[i + 1];
  const p = v && !v.startsWith('-') ? v : 'keygen-ledger.jsonl';
  return path.resolve(process.cwd(), p);
}

export function withLedgerFileLock<T>(ledgerFile: string, fn: () => T): T {
  const lock = `${ledgerFile}.lock`;
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 60000) fs.rmSync(lock, { force: true });
      } catch { /* missing lock — take it below */ }
      fs.writeFileSync(lock, `${process.pid}`, { flag: 'wx' });
      break;
    } catch {
      if (Date.now() > deadline) {
        console.error('Ledger is locked (the desk station may be issuing) — retry, or issue from the desk.');
        process.exit(2);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.rmSync(lock, { force: true }); } catch { /* lock already gone */ }
  }
}

export interface CliLedgerEntry {
  store: string;
  hwid: string;
  key: string;
  note?: string;
}

/** Append a self-checked issuance to the shared ledger. Loud no-op when file is null. */
export function recordLedgerEntry(ledgerFile: string | null, entry: CliLedgerEntry): void {
  if (!ledgerFile) {
    console.log('LEDGER: skipped (--no-ledger) — this issuance is NOT recorded.');
    return;
  }
  withLedgerFileLock(ledgerFile, () => {
    let prev: LedgerEntry[] = [];
    try {
      const t = fs.readFileSync(ledgerFile, 'utf8');
      if (t.trim()) prev = ledgerParse(t);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (ledgerVerify(prev).brokenAt !== null) {
      console.error(`LEDGER: TAMPERED — refusing to append. Restore from ${ledgerFile.replace(/\.jsonl$/, '.backup.jsonl')} first.`);
      process.exit(2);
    }
    const row = ledgerAppend(prev, {
      ts: new Date().toISOString(), kind: 'issue',
      store: entry.store, hwid: entry.hwid, key: entry.key,
      note: entry.note ?? 'cli-issue',
    });
    fs.appendFileSync(ledgerFile, `${JSON.stringify(row)}\n`);
    console.log(`LEDGER: appended #${row.seq} → ${ledgerFile}`);
  });
}
