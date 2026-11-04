/**
 * Baraka Market — activation-desk pure core (staff tool, ADR-002-MKT).
 * Crypto is FROZEN in `core/licensing.ts` (client compatibility) — this file
 * holds only the desk's pure logic: arg parsing, HWID canonicalization,
 * receipt rendering, and the tamper-evident issuance ledger. All IO
 * (prompts, files, signing) lives in `scripts/activation-desk.ts`, so every
 * rule here is unit-tested without a private key.
 *
 * @module core/activation-desk
 */
import { createHash } from 'node:crypto';

export const HWID_RE = /^BM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

/**
 * Canonicalize a human-supplied HWID: trim, uppercase, strip spaces, and
 * insert dashes when 16 bare hex chars are given. Returns null when the
 * value cannot be salvaged (caller shows the expected pattern, never hangs).
 */
export function canonicalizeHwid(raw: string): string | null {
  const compact = raw.trim().toUpperCase().replace(/[\s_]/g, '');
  const dashed = compact.includes('-')
    ? compact
    : compact.length === 16
      ? `BM-${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}`
      : compact.length === 18 && compact.startsWith('BM')
        ? `BM-${compact.slice(2, 6)}-${compact.slice(6, 10)}-${compact.slice(10, 14)}-${compact.slice(14, 18)}`
        : compact;
  return HWID_RE.test(dashed) ? dashed : null;
}

export type DeskCommand =
  | { name: 'generate'; store?: string; hwid?: string; json: boolean; yes: boolean; keyFile?: string }
  | { name: 'verify'; store?: string; hwid?: string; key?: string; json: boolean }
  | { name: 'hwid'; seed?: string; json: boolean }
  | { name: 'ledger'; verify: boolean; csv: boolean; last: number; revoke: number | null }
  | { name: 'version' }
  | { name: 'help'; topic?: string };

/** Minimal flag parser: `--key value` / `--key=value` / `--flag`. First positional is the command. */
export function parseDeskArgs(argv: string[]): DeskCommand {
  const [cmd = 'help', ...rest] = argv;
  const get = (name: string): string | undefined => {
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === `--${name}`) return rest[i + 1];
      if (rest[i].startsWith(`--${name}=`)) return rest[i].slice(name.length + 3);
    }
    return undefined;
  };
  const has = (name: string): boolean => rest.includes(`--${name}`);
  const json = has('json');
  switch (cmd.toLowerCase()) {
    case 'generate':
      return { name: 'generate', store: get('store'), hwid: get('hwid'), keyFile: get('key-file'), json, yes: has('yes') };
    case 'verify':
      return { name: 'verify', store: get('store'), hwid: get('hwid'), key: get('key'), json };
    case 'hwid':
      return { name: 'hwid', seed: get('seed'), json };
    case 'ledger': {
      const lastRaw = get('last');
      const revokeRaw = get('revoke');
      return {
        name: 'ledger',
        verify: has('verify'),
        csv: has('csv'),
        last: lastRaw === undefined ? 10 : Math.max(1, Number.parseInt(lastRaw, 10) || 10),
        revoke: revokeRaw === undefined ? null : Number.parseInt(revokeRaw, 10),
      };
    }
    case 'version':
      return { name: 'version' };
    default:
      return { name: 'help', topic: cmd === 'help' ? get('topic') : cmd };
  }
}

export interface LedgerEntry {
  seq: number;
  ts: string;
  kind: 'issue' | 'revoke';
  store: string;
  hwid: string;
  key: string;
  note: string;
  prev: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);

export const ledgerHash = (prev: string, seq: number, ts: string, kind: string, store: string, hwid: string, key: string): string =>
  createHash('sha256').update([prev, seq, ts, kind, store, hwid, key].join('|')).digest('hex');

export function ledgerAppend(prevEntries: LedgerEntry[], input: { ts: string; kind: 'issue' | 'revoke'; store: string; hwid: string; key: string; note?: string }): LedgerEntry {
  const prev = prevEntries.length === 0 ? GENESIS : prevEntries[prevEntries.length - 1].hash;
  const seq = prevEntries.length + 1;
  return {
    seq, ts: input.ts, kind: input.kind, store: input.store, hwid: input.hwid,
    key: input.key, note: input.note ?? '', prev,
    hash: ledgerHash(prev, seq, input.ts, input.kind, input.store, input.hwid, input.key),
  };
}

/** Replay the chain: linkage + recompute every hash. Returns the first broken seq, or null when intact. */
export function ledgerVerify(entries: LedgerEntry[]): { brokenAt: number | null; count: number } {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prev !== prev) return { brokenAt: e.seq, count: entries.length };
    if (e.hash !== ledgerHash(e.prev, e.seq, e.ts, e.kind, e.store, e.hwid, e.key)) {
      return { brokenAt: e.seq, count: entries.length };
    }
    prev = e.hash;
  }
  return { brokenAt: null, count: entries.length };
}

/** Parse JSONL ledger text, skipping blank lines; throws on the first malformed line. */
export function ledgerParse(text: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LedgerEntry);
    } catch {
      throw new Error(`ledger line ${i + 1} is not valid JSON`);
    }
  }
  return out;
}

/** Human receipt card + one-line SMS for the shopkeeper. Key appears once; never logged elsewhere. */
export function renderReceipt(store: string, hwid: string, key: string, seq: number, priceDzd: number): string {
  const bar = '═'.repeat(46);
  return [
    `╔${bar}╗`,
    `║  Baraka Market — مفتاح التفعيل  (#${seq})${' '.repeat(Math.max(0, 46 - 34 - String(seq).length))}║`,
    `╠${bar}╝`,
    `STORE: ${store}`,
    `HWID : ${hwid}`,
    `KEY  : ${key}`,
    `PRICE: ${priceDzd} DZD (informational — enforced by sales policy)`,
    `CHECK: VALID (self-verified at issuance)`,
    `--- WhatsApp / SMS (copy below) ---`,
    `سلام، مفتاح تفعيل Baraka Market لمحل "${store}": ${key} — الصقه في الإعدادات ← الترخيص ← تفعيل.`,
  ].join('\n');
}

export const DESK_VERSION = '3.0.0';
