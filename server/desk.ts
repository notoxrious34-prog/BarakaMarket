/**
 * Baraka Activation Desk v4 — staff web station (localhost only).
 * The private key NEVER leaves this process: the browser UI calls
 * /api/desk/* and receives only issued keys. Same Ed25519 core
 * (ADR-002 FROZEN) and same hash-chained ledger as the CLI.
 *
 * v4 hardening (professional tier):
 * - Serial ledger mutex: concurrent generate/revoke calls can no longer
 *   read the same `prev` and fork the chain (double-click / two tabs).
 * - Operator token (`x-baraka-desk`, minted beside the ledger): every POST
 *   is gated, like the main server's loopback token (ADR-025). GETs stay
 *   open (read-only). Delete `.desk-token` to rotate.
 * - Duplicate guard: re-issuing an ACTIVE (store, hwid) pair returns 409
 *   unless `force:true` (explicit override, audit-logged).
 * - Append-only audit trail (`desk-audit.log`) for every mutation + verify.
 * - Write-through backup (`keygen-ledger.backup.jsonl`) on every append.
 * - Optional client meta on issues (phone/wilaya/paid/note) — carried
 *   UNHASHED, so the chain formula and old entries are untouched.
 *
 * Run:  npm run desk   →  http://127.0.0.1:3200/desk.html
 * Dev:  npm run desk (API) + npm run dev (Vite proxies /api/desk).
 * Test isolation: DESK_DATA_DIR=<tmp> redirects ledger/token/audit/backup.
 *
 * @module server/desk
 */
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPrivateKey, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import {
  computeHwid, collectNodeFingerprint, buildLicensePayload,
  formatActivationKey, validateLicense, canonicalStoreName, LICENSE_PRICE_DZD,
} from '../src/core/licensing.js';
import {
  canonicalizeHwid, ledgerAppend, ledgerVerify, ledgerParse,
  DESK_VERSION, type LedgerEntry, type LedgerMeta,
} from '../src/core/activation-desk.js';

export const DESK_PORT = Number(process.env.DESK_PORT ?? 3200);
export const DESK_TOKEN_HEADER = 'x-baraka-desk';

function exeDir(): string {
  try {
    const d = path.dirname(process.execPath);
    if (!process.execPath.toLowerCase().includes('node')) return d;
  } catch { /* fall through */ }
  return process.cwd();
}

function keySource(): { key: ReturnType<typeof createPrivateKey> | null; source: string; permWarn: string | null } {
  const permCheck = (p: string): string | null => {
    if (process.platform === 'win32') return null; // mode bits are meaningless on Windows ACLs
    try {
      const st = fs.statSync(p);
      // eslint-disable-next-line no-bitwise
      return (st.mode & 0o077) !== 0 ? `${p} is readable beyond its owner — chmod 600` : null;
    } catch {
      return null;
    }
  };
  if (process.env.BARAKA_PRIVATE_KEY) {
    try {
      return { key: createPrivateKey(process.env.BARAKA_PRIVATE_KEY), source: 'env:BARAKA_PRIVATE_KEY', permWarn: null };
    } catch {
      return { key: null, source: 'env:BARAKA_PRIVATE_KEY (invalid PEM)', permWarn: null };
    }
  }
  for (const dir of [exeDir(), process.cwd()]) {
    const p = path.join(dir, '.baraka-privkey.pem');
    if (fs.existsSync(p)) {
      try {
        return { key: createPrivateKey(fs.readFileSync(p, 'utf8')), source: p, permWarn: permCheck(p) };
      } catch {
        return { key: null, source: `${p} (invalid PEM)`, permWarn: null };
      }
    }
  }
  return { key: null, source: 'missing — .baraka-privkey.pem next to the app or BARAKA_PRIVATE_KEY', permWarn: null };
}

/** Overridable for tests (DESK_DATA_DIR); production = next to the exe. */
export function deskDataDir(): string {
  const override = (process.env.DESK_DATA_DIR ?? '').trim();
  const dir = override || exeDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const ledgerPath = (): string => path.join(deskDataDir(), 'keygen-ledger.jsonl');
const backupPath = (): string => path.join(deskDataDir(), 'keygen-ledger.backup.jsonl');
const auditPath = (): string => path.join(deskDataDir(), 'desk-audit.log');
const tokenPath = (): string => path.join(deskDataDir(), '.desk-token');

/** Mint-once 256-bit operator token; delete the file to rotate. */
export function ensureDeskToken(): string {
  const p = tokenPath();
  try {
    const t = fs.readFileSync(p, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(t)) return t;
  } catch { /* first boot — mint below */ }
  const t = randomBytes(32).toString('hex');
  fs.writeFileSync(p, t, { mode: 0o600 });
  return t;
}

export function checkDeskToken(req: express.Request): boolean {
  const got = req.headers[DESK_TOKEN_HEADER];
  const want = ensureDeskToken();
  if (typeof got !== 'string' || got.length !== want.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(want, 'utf8'));
  } catch {
    return false;
  }
}

function readLedger(): LedgerEntry[] {
  try {
    return ledgerParse(fs.readFileSync(ledgerPath(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

function backupCount(): number {
  try {
    return ledgerParse(fs.readFileSync(backupPath(), 'utf8')).length;
  } catch {
    return 0;
  }
}

/** One-time catch-up: when the backup is missing/stale but the live chain
 *  verifies, seed it as an exact copy — pre-backup entries included. */
function backfillBackupOnce(): void {
  try {
    const live = readLedger();
    if (live.length === 0 || backupCount() === live.length) return;
    if (ledgerVerify(live).brokenAt !== null) return;
    fs.writeFileSync(backupPath(), live.map(e => JSON.stringify(e)).join('\n') + '\n');
  } catch { /* best-effort: issuance never depends on the backup */ }
}

/** Append to the ledger AND the write-through backup (backup is best-effort). */
function writeEntry(e: LedgerEntry): void {
  fs.appendFileSync(ledgerPath(), `${JSON.stringify(e)}\n`);
  try {
    fs.appendFileSync(backupPath(), `${JSON.stringify(e)}\n`);
  } catch { /* backup must never block issuance */ }
}

export interface AuditRow {
  ts: string;
  action: 'generate' | 'verify' | 'revoke';
  store?: string;
  hwid?: string;
  seq?: number;
  ok: boolean;
  detail?: string;
}

function audit(row: Omit<AuditRow, 'ts'>): void {
  try {
    fs.appendFileSync(auditPath(), `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
  } catch { /* audit is best-effort, never blocks the operation */ }
}

function readAudit(): AuditRow[] {
  try {
    return fs.readFileSync(auditPath(), 'utf8').split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as AuditRow);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/**
 * Serial ledger mutex. The read→append→write sequence must be atomic:
 * two concurrent generates otherwise compute the same `prev` and the
 * second entry forks/breaks the chain. Every ledger mutation runs inside.
 */
let ledgerGate: Promise<void> = Promise.resolve();
function withLedgerLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = ledgerGate.then(fn);
  ledgerGate = run.then(() => undefined, () => undefined);
  return run;
}

/** Latest non-revoked `issue` for a (store, hwid) pair, or null. */
export function findActiveIssue(entries: LedgerEntry[], store: string, hwid: string): LedgerEntry | null {
  const revokedSeq = new Set<number>();
  const revokedKey = new Set<string>();
  for (const e of entries) {
    if (e.kind !== 'revoke') continue;
    if (typeof e.revokes === 'number') revokedSeq.add(e.revokes);
    else {
      // Legacy markers (v3): recover the target from the note or the key.
      const m = /→ #(\d+)/.exec(e.note ?? '');
      if (m) revokedSeq.add(Number(m[1]));
      if (e.key) revokedKey.add(e.key);
    }
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === 'issue' && e.store === store && e.hwid === hwid &&
      !revokedSeq.has(e.seq) && !revokedKey.has(e.key)) {
      return e;
    }
  }
  return null;
}

function sanitizeMeta(raw: unknown): LedgerMeta | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  const out: LedgerMeta = {};
  const str = (v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim().slice(0, max);
    return t ? t : undefined;
  };
  const phone = str(m.phone, 32);
  const wilaya = str(m.wilaya, 64);
  const note = str(m.note, 200);
  if (phone) out.phone = phone;
  if (wilaya) out.wilaya = wilaya;
  if (note) out.note = note;
  if (typeof m.paidDzd === 'number' && Number.isFinite(m.paidDzd) && m.paidDzd >= 0) {
    out.paidDzd = Math.floor(m.paidDzd);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function createDeskApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  // Loopback station: no CORS, no remote binds (listen is 127.0.0.1-only below).
  app.disable('x-powered-by');
  ensureDeskToken();

  const needToken = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    if (checkDeskToken(req)) { next(); return; }
    res.status(401).json({ error: 'رمز المشغّل مطلوب (x-baraka-desk). الصقه من طرفية الخادم — احذف .desk-token للتدوير.' });
  };

  app.get('/api/desk/health', (_req, res) => {
    const { key, source, permWarn } = keySource();
    let count = 0;
    let brokenAt: number | null = null;
    try {
      const entries = readLedger();
      count = entries.length;
      brokenAt = ledgerVerify(entries).brokenAt;
    } catch { /* ledger unreadable — surfaced on /ledger */ }
    res.json({
      ok: true, version: DESK_VERSION,
      keyLoaded: key !== null, keySource: source, keyPermWarn: permWarn,
      ledgerCount: count, ledgerBrokenAt: brokenAt,
      backupCount: backupCount(), priceDzd: LICENSE_PRICE_DZD,
    });
  });

  app.get('/api/desk/hwid', (req, res) => {
    const seed = typeof req.query.seed === 'string' && req.query.seed ? req.query.seed : (process.env.BARAKA_SEED ?? 'shop-pos-seed');
    res.json({ hwid: computeHwid(collectNodeFingerprint(seed, os)) });
  });

  app.post('/api/desk/generate', needToken, async (req, res) => {
    const { store: rawStore, hwid: rawHwid, meta: rawMeta, force } = (req.body ?? {}) as {
      store?: unknown; hwid?: unknown; meta?: unknown; force?: unknown;
    };
    if (typeof rawStore !== 'string' || !rawStore.trim()) {
      res.status(400).json({ error: 'اسم المحل مطلوب.' });
      return;
    }
    const hwid = typeof rawHwid === 'string' ? canonicalizeHwid(rawHwid) : null;
    if (!hwid) {
      res.status(400).json({ error: 'HWID غير صالح — الصيغة BM-XXXX-XXXX-XXXX-XXXX (الشرطات اختيارية).' });
      return;
    }
    const store = canonicalStoreName(rawStore);
    const meta = sanitizeMeta(rawMeta);
    try {
      const out = await withLedgerLock(async () => {
        const dup = findActiveIssue(readLedger(), store, hwid);
        if (dup && force !== true) {
          audit({ action: 'generate', store, hwid, ok: false, detail: `duplicate refused (active #${dup.seq})` });
          res.status(409).json({ error: `إصدار نشط موجود مسبقاً (#${dup.seq} — ${dup.ts.slice(0, 10)}). أكّد التجاوز للإصدار المكرر.`, existingSeq: dup.seq });
          return null;
        }
        const { key, source } = keySource();
        if (!key) {
          audit({ action: 'generate', store, hwid, ok: false, detail: 'private key missing' });
          res.status(503).json({ error: `المفتاح الخاص غير متوفر (${source}).` });
          return null;
        }
        const license = formatActivationKey(sign(null, buildLicensePayload(store, hwid), key).toString('base64url'));
        if (!(await validateLicense(store, hwid, license))) {
          audit({ action: 'generate', store, hwid, ok: false, detail: 'SELF-CHECK FAILED' });
          res.status(500).json({ error: 'SELF-CHECK FAILED — المفتاح لا يتحقق ذاتياً. توقف فوري، لا توزع.' });
          return null;
        }
        try {
          const entry = ledgerAppend(readLedger(), {
            ts: new Date().toISOString(), kind: 'issue', store, hwid, key: license, meta,
          });
          writeEntry(entry);
          audit({
            action: 'generate', store, hwid, seq: entry.seq, ok: true,
            detail: dup ? `duplicate override of #${dup.seq}` : undefined,
          });
          return entry;
        } catch (e) {
          audit({ action: 'generate', store, hwid, ok: false, detail: `ledger write failed: ${(e as Error).message}` });
          res.status(500).json({ error: `تم التوقيع لكن تعذر الكتابة في السجل: ${(e as Error).message}` });
          return null;
        }
      });
      if (out) res.json({ store, hwid, key: out.key, seq: out.seq, ts: out.ts, priceDzd: LICENSE_PRICE_DZD, meta: out.meta ?? null });
    } catch (e) {
      res.status(500).json({ error: `فشل داخلي: ${(e as Error).message}` });
    }
  });

  app.post('/api/desk/verify', needToken, async (req, res) => {
    const { store: rawStore, hwid: rawHwid, key: rawKey } = (req.body ?? {}) as { store?: unknown; hwid?: unknown; key?: unknown };
    const store = typeof rawStore === 'string' ? rawStore : '';
    const hwid = typeof rawHwid === 'string' ? canonicalizeHwid(rawHwid) : null;
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    const valid = !!hwid && !!key && (await validateLicense(store, hwid, key));
    audit({ action: 'verify', store: canonicalStoreName(store), hwid: hwid ?? undefined, ok: valid });
    res.json({ store: canonicalStoreName(store), hwid, valid });
  });

  app.get('/api/desk/ledger', (req, res) => {
    const last = Math.max(1, Number.parseInt(String(req.query.last ?? '100'), 10) || 100);
    let entries: LedgerEntry[];
    try {
      entries = readLedger();
    } catch (e) {
      res.status(500).json({ error: `تعذر قراءة السجل: ${(e as Error).message}` });
      return;
    }
    const v = ledgerVerify(entries);
    res.json({ entries: entries.slice(-last), count: entries.length, brokenAt: v.brokenAt, priceDzd: LICENSE_PRICE_DZD });
  });

  app.post('/api/desk/ledger/revoke', needToken, async (req, res) => {
    const seq = Number((req.body as { seq?: unknown } ?? {}).seq);
    if (!Number.isInteger(seq) || seq < 1) {
      res.status(400).json({ error: 'رقم التسلسل (seq) مطلوب.' });
      return;
    }
    try {
      const marker = await withLedgerLock(async () => {
        let entries: LedgerEntry[];
        try {
          entries = readLedger();
        } catch (e) {
          res.status(500).json({ error: `تعذر قراءة السجل: ${(e as Error).message}` });
          return null;
        }
        const target = entries.find(e => e.seq === seq && e.kind === 'issue');
        if (!target) {
          res.status(404).json({ error: `لا يوجد إصدار بالرقم #${seq}.` });
          return null;
        }
        if (findActiveIssue(entries, target.store, target.hwid)?.seq !== seq) {
          res.status(409).json({ error: `الإصدار #${seq} ملغي مسبقاً أو مستبدَل.` });
          return null;
        }
        const mark = ledgerAppend(entries, {
          ts: new Date().toISOString(), kind: 'revoke',
          store: target.store, hwid: target.hwid, key: target.key, revokes: seq,
          note: `revoked by operator (staff-side reference; clients verify offline) → #${seq}`,
        });
        try {
          writeEntry(mark);
        } catch (e) {
          res.status(500).json({ error: `تعذر الكتابة في السجل: ${(e as Error).message}` });
          return null;
        }
        audit({ action: 'revoke', store: target.store, hwid: target.hwid, seq, ok: true });
        return mark;
      });
      if (marker) res.json({ marker });
    } catch (e) {
      res.status(500).json({ error: `فشل داخلي: ${(e as Error).message}` });
    }
  });

  /** Restore-verify: check an uploaded ledger/backup file without touching the live chain. */
  app.post('/api/desk/ledger/check', needToken, (req, res) => {
    const { text } = (req.body ?? {}) as { text?: unknown };
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'نص السجل مطلوب.' });
      return;
    }
    let entries: LedgerEntry[];
    try {
      entries = ledgerParse(text);
    } catch (e) {
      res.status(400).json({ error: `ملف غير صالح: ${(e as Error).message}` });
      return;
    }
    const v = ledgerVerify(entries);
    res.json({ count: entries.length, brokenAt: v.brokenAt });
  });

  app.get('/api/desk/audit', (req, res) => {
    const last = Math.max(1, Number.parseInt(String(req.query.last ?? '200'), 10) || 200);
    let rows: AuditRow[];
    try {
      rows = readAudit();
    } catch (e) {
      res.status(500).json({ error: `تعذر قراءة التدقيق: ${(e as Error).message}` });
      return;
    }
    res.json({ entries: rows.slice(-last), count: rows.length });
  });

  app.get('/api/desk/stats', (_req, res) => {
    let entries: LedgerEntry[] = [];
    try {
      entries = readLedger();
    } catch { /* treat as empty */ }
    const issued = entries.filter(e => e.kind === 'issue').length;
    const revoked = entries.filter(e => e.kind === 'revoke').length;
    res.json({
      issued, revoked,
      revenueDzd: issued * LICENSE_PRICE_DZD,
      priceDzd: LICENSE_PRICE_DZD,
      count: entries.length,
      brokenAt: ledgerVerify(entries).brokenAt,
    });
  });

  // Production: serve the built bundle (vite multi-input emits desk.html).
  const distDir = path.resolve(process.cwd(), 'dist');
  const deskHtml = path.join(distDir, 'desk.html');
  if (fs.existsSync(deskHtml)) {
    app.use(express.static(distDir, { index: false }));
    app.get(['/desk', '/desk.html', '/'], (_req, res) => res.sendFile(deskHtml));
  }

  return app;
}

const isMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\//, ''));
if (isMain || process.env.DESK_STANDALONE === '1') {
  const app = createDeskApp();
  backfillBackupOnce();
  app.listen(DESK_PORT, '127.0.0.1', () => {
    const { key, source, permWarn } = keySource();
    console.log(`[desk] Baraka Activation Desk v${DESK_VERSION} — STAFF ONLY`);
    console.log(`[desk] http://127.0.0.1:${DESK_PORT}/desk.html`);
    console.log(`[desk] private key: ${key ? `loaded (${source})` : `MISSING (${source})`}`);
    if (permWarn) console.log(`[desk] WARNING: ${permWarn}`);
    console.log(`[desk] ledger: ${ledgerPath()} (+ write-through backup)`);
    console.log(`[desk] operator token (${tokenPath()}): ${ensureDeskToken()}`);
  });
}
