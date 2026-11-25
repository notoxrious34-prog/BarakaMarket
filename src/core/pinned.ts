/**
 * ADR-053 P3 — pinned catalog core: fake-barcode guard + tile refs + NULL norm.
 * Pure (no I/O): the lanes call normalizeBarcodeForDb, the UI calls
 * detectFakeBarcode for the 1-click warning + explicit owner override.
 */
export type FakeKind = 'OK' | 'EMPTY' | 'FAKE_SHORT' | 'FAKE_REPEAT' | 'FAKE_SEQ';

export interface FakeVerdict {
  kind: FakeKind;
  /** Stable machine code (=== kind) for tests/audit. */
  code: FakeKind;
  /** i18n hint key resolved by the UI (AR/FR). */
  hintKey: string;
}

/** Human-readable pattern list (shown in the override dialog). */
export const FAKE_PATTERNS_DOC =
  'short numeric (≤6 digits) · repeated char · sequential run · empty→NULL';

const HINTS: Record<FakeKind, string> = {
  OK: 'barcode.ok',
  EMPTY: 'barcode.empty_null',
  FAKE_SHORT: 'barcode.fake_short',
  FAKE_REPEAT: 'barcode.fake_repeat',
  FAKE_SEQ: 'barcode.fake_seq',
};

function isRepeat(s: string): boolean {
  return s.length >= 2 && [...s].every(ch => ch === s[0]);
}

function isSequential(s: string): boolean {
  if (s.length < 4 || !/^\d+$/.test(s)) return false;
  const d = [...s].map(Number);
  const up = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  const dn = d.every((v, i) => i === 0 || v === d[i - 1] - 1);
  return up || dn;
}

/**
 * Anti-fake guard (control #4): warns, never blocks — the owner override
 * path stays open for real scale PLUs (J5/B3). Precedence: EMPTY > REPEAT >
 * SEQ > SHORT > OK (strongest signal wins).
 */
export function detectFakeBarcode(raw: string | null | undefined): FakeVerdict {
  const code = (raw ?? '').trim();
  let kind: FakeKind = 'OK';
  if (code.length === 0) kind = 'EMPTY';
  else if (isRepeat(code)) kind = 'FAKE_REPEAT';
  else if (isSequential(code)) kind = 'FAKE_SEQ';
  else if (/^\d{1,6}$/.test(code)) kind = 'FAKE_SHORT';
  return { kind, code: kind, hintKey: HINTS[kind] };
}

/**
 * Control #1: `""` NEVER reaches the DB — empty/whitespace becomes NULL
 * (UNIQUE accepts repeated NULLs, rejects repeated `""`).
 */
export function normalizeBarcodeForDb(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  return t.length === 0 ? null : t;
}

/** Max visible tiles on one screen (control #5 — zéro-scrollbar). */
export const MAX_PIN_TILES = 12;

/**
 * `#N` tile refs (Aldi-style): `#1`..`#12`. Anything else (EAN, scale
 * labels, `N*CODE`, garbage) → null. `N*#N` composes via parseQtyPrefix.
 */
export function parseTileRef(core: string): number | null {
  const t = core.trim();
  const m = /^#(\d{1,2})$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_PIN_TILES ? n : null;
}
