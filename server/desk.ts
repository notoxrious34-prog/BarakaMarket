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
  canonicalizeHwid, ledgerAppend, ledgerVerify, ledgerParse, ledgerTransfer,
  DESK_VERSION, type LedgerEntry, type LedgerMeta,
} from '../src/core/activation-desk.js';
import {
  envelopeFromInput, buildEnvelopePayload, formatEnvelopeKey, validateEnvelopeKey,
  parseEnvelopeKey, type LicenseTier,
} from '../src/core/license-envelope.js';
import {
  buildUnlockPayload, formatUnlockToken, verifyUnlock, type UnlockScope,
} from '../src/core/license-unlock.js';

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
  // Optional second roof: DESK_BACKUP_DIR (e.g. a USB stick or synced folder).
  const extra = process.env.DESK_BACKUP_DIR;
  if (extra) {
    try {
      fs.appendFileSync(path.join(extra, 'keygen-ledger.backup.jsonl'), `${JSON.stringify(e)}\n`);
    } catch { /* second roof is best-effort too */ }
  }
}

export interface AuditRow {
  ts: string;
  action: 'generate' | 'verify' | 'revoke' | 'unlock' | 'transfer';
  store?: string;
  hwid?: string;
  seq?: number;
  ok: boolean;
  detail?: string;
}

const AUDIT_MAX_BYTES = 1_000_000; // 1MB per generation, then rotate once.

function audit(row: Omit<AuditRow, 'ts'>): void {
  try {
    const p = auditPath();
    try {
      if (fs.statSync(p).size >= AUDIT_MAX_BYTES) {
        fs.renameSync(p, `${p}.1`);
      }
    } catch { /* missing file — nothing to rotate */ }
    fs.appendFileSync(p, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
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

class DeskHttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

export interface V2MintInfo {
  tier: LicenseTier;
  exp: number | null;
  maxVer: string | null;
  hwid2: string | null;
}

type MintFormat = 'v1' | 'v2';

/**
 * Shared minter for /generate and /transfer: v1 classic (`STORE||HWID`)
 * or v2 envelope (tier/expiry/maxVer/spare HWID, ADR-050). Throws
 * DeskHttpError(400) on bad policy input.
 */
async function mintLicenseKey(opts: {
  store: string; hwid1: string; format: MintFormat;
  tier?: unknown; expires?: unknown; maxVer?: unknown; hwid2?: unknown;
  key: NonNullable<ReturnType<typeof keySource>['key']>; nowMs: number;
}): Promise<{ key: string; v2: V2MintInfo | null }> {
  if (opts.format === 'v1') {
    return {
      key: formatActivationKey(sign(null, buildLicensePayload(opts.store, opts.hwid1), opts.key).toString('base64url')),
      v2: null,
    };
  }
  const tierRaw = typeof opts.tier === 'string' ? opts.tier.toUpperCase() : 'PERP';
  if (tierRaw !== 'PERP' && tierRaw !== 'SUPPORT12') throw new DeskHttpError(400, 'الطبقة: PERP أو SUPPORT12.');
  let exp: number | null = null;
  if (opts.expires !== undefined && opts.expires !== null && opts.expires !== '') {
    const raw = typeof opts.expires === 'number' ? opts.expires : Date.parse(`${String(opts.expires).slice(0, 10)}T23:59:59Z`);
    if (!Number.isInteger(raw) || raw <= opts.nowMs) throw new DeskHttpError(400, 'تاريخ الانتهاء يجب أن يكون في المستقبل (YYYY-MM-DD).');
    exp = raw;
  }
  const maxVer = typeof opts.maxVer === 'string' && opts.maxVer.trim() ? opts.maxVer.trim() : null;
  if (maxVer !== null && !/^\d+\.\d+\.\d+$/.test(maxVer)) throw new DeskHttpError(400, 'سقف النسخة بصيغة X.Y.Z (مثال: 1.10.0).');
  let hwid2: string | null = null;
  if (typeof opts.hwid2 === 'string' && opts.hwid2.trim()) {
    hwid2 = canonicalizeHwid(opts.hwid2);
    if (!hwid2) throw new DeskHttpError(400, 'البصمة الاحتياطية (hwid2) غير صالحة.');
    if (hwid2 === opts.hwid1) throw new DeskHttpError(400, 'البصمة الاحتياطية يجب أن تختلف عن الأساسية.');
  }
  const env = envelopeFromInput(opts.store, {
    tier: tierRaw, issuedMs: opts.nowMs, expiresMs: exp, maxVer, hwid1: opts.hwid1, hwid2,
  });
  if (!env) throw new DeskHttpError(400, 'مدخلات المظروف v2 غير صالحة — راجع الطبقة والتواريخ والبصمات.');
  const sig = sign(null, Buffer.from(buildEnvelopePayload(env)), opts.key).toString('base64url');
  return { key: formatEnvelopeKey(env, sig), v2: { tier: env.tier, exp: env.exp, maxVer: env.maxVer, hwid2: env.h2 } };
}

async function selfCheckOk(store: string, hwid: string, key: string, format: MintFormat, nowMs: number): Promise<boolean> {
  if (format === 'v1') return validateLicense(store, hwid, key);
  return (await validateEnvelopeKey(store, hwid, key, nowMs)).ok;
}

export function createDeskApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  /** Loopback throttle: 240 signed POSTs/min/IP (double-clicks never hit it). */
  const postHits = new Map<string, number[]>();
  app.use('/api/desk', (req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    const now = Date.now();
    const ip = req.ip ?? 'local';
    const win = (postHits.get(ip) ?? []).filter(t => now - t < 60000);
    win.push(now);
    postHits.set(ip, win);
    if (win.length > 240) {
      audit({ action: 'verify', ok: false, detail: `rate-limited ${ip}` });
      res.status(429).json({ error: 'طلبات كثيرة — انتظر دقيقة.' });
      return;
    }
    next();
  });
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
    let lastIssueTs: string | null = null;
    try {
      const entries = readLedger();
      count = entries.length;
      brokenAt = ledgerVerify(entries).brokenAt;
      lastIssueTs = [...entries].reverse().find(e => e.kind === 'issue')?.ts ?? null;
    } catch { /* ledger unreadable — surfaced on /ledger */ }
    let auditCount = 0;
    try {
      auditCount = readAudit().length;
    } catch { /* audit unreadable — still report health */ }
    res.json({
      ok: true, version: DESK_VERSION,
      keyLoaded: key !== null, keySource: source, keyPermWarn: permWarn,
      ledgerCount: count, ledgerBrokenAt: brokenAt,
      backupCount: backupCount(), priceDzd: LICENSE_PRICE_DZD,
      auditCount, lastIssueTs,
    });
  });

  app.get('/api/desk/hwid', (req, res) => {
    const seed = typeof req.query.seed === 'string' && req.query.seed ? req.query.seed : (process.env.BARAKA_SEED ?? 'shop-pos-seed');
    res.json({ hwid: computeHwid(collectNodeFingerprint(seed, os)) });
  });

  app.post('/api/desk/generate', needToken, async (req, res) => {
    const { store: rawStore, hwid: rawHwid, meta: rawMeta, force, format: rawFormat, v2: rawV2 } = (req.body ?? {}) as {
      store?: unknown; hwid?: unknown; meta?: unknown; force?: unknown; format?: unknown; v2?: unknown;
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
    const format: MintFormat = rawFormat === 'v2' ? 'v2' : 'v1';
    const v2raw = (typeof rawV2 === 'object' && rawV2 !== null ? rawV2 : {}) as {
      tier?: unknown; expires?: unknown; maxVer?: unknown; hwid2?: unknown;
    };
    const store = canonicalStoreName(rawStore);
    const meta = sanitizeMeta(rawMeta);
    try {
      const out = await withLedgerLock(async () => {
        const entries = readLedger();
        const dup = findActiveIssue(entries, store, hwid);
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
        const nowMs = Date.now();
        let minted: { key: string; v2: V2MintInfo | null };
        try {
          minted = await mintLicenseKey({ store, hwid1: hwid, format, ...v2raw, key, nowMs });
        } catch (e) {
          if (e instanceof DeskHttpError) {
            audit({ action: 'generate', store, hwid, ok: false, detail: `bad v2 input: ${e.message}` });
            res.status(e.status).json({ error: e.message });
            return null;
          }
          throw e;
        }
        if (!(await selfCheckOk(store, hwid, minted.key, format, nowMs))) {
          audit({ action: 'generate', store, hwid, ok: false, detail: 'SELF-CHECK FAILED' });
          res.status(500).json({ error: 'SELF-CHECK FAILED — المفتاح لا يتحقق ذاتياً. توقف فوري، لا توزع.' });
          return null;
        }
        try {
          const entry = ledgerAppend(entries, {
            ts: new Date(nowMs).toISOString(), kind: 'issue', store, hwid, key: minted.key, meta,
          });
          writeEntry(entry);
          audit({
            action: 'generate', store, hwid, seq: entry.seq, ok: true,
            detail: dup ? `duplicate override of #${dup.seq}` : format === 'v2' ? `v2 ${minted.v2!.tier}` : undefined,
          });
          return { entry, v2: minted.v2 };
        } catch (e) {
          audit({ action: 'generate', store, hwid, ok: false, detail: `ledger write failed: ${(e as Error).message}` });
          res.status(500).json({ error: `تم التوقيع لكن تعذر الكتابة في السجل: ${(e as Error).message}` });
          return null;
        }
      });
      if (out) res.json({
        store, hwid, key: out.entry.key, seq: out.entry.seq, ts: out.entry.ts,
        priceDzd: LICENSE_PRICE_DZD, meta: out.entry.meta ?? null, format, v2: out.v2,
      });
    } catch (e) {
      res.status(500).json({ error: `فشل داخلي: ${(e as Error).message}` });
    }
  });

  app.post('/api/desk/verify', needToken, async (req, res) => {
    const { store: rawStore, hwid: rawHwid, key: rawKey } = (req.body ?? {}) as { store?: unknown; hwid?: unknown; key?: unknown };
    const store = typeof rawStore === 'string' ? rawStore : '';
    const hwid = typeof rawHwid === 'string' ? canonicalizeHwid(rawHwid) : null;
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    const nowMs = Date.now();
    let valid = false;
    let format: 'v1' | 'v2' | null = null;
    let tier: LicenseTier | undefined;
    let slot: 1 | 2 | undefined;
    let expired = false;
    let maxVer: string | null = null;
    if (hwid && key) {
      if (await validateLicense(store, hwid, key)) {
        valid = true;
        format = 'v1';
      } else if (parseEnvelopeKey(key) !== null) {
        format = 'v2';
        const v = await validateEnvelopeKey(store, hwid, key, nowMs);
        valid = v.ok;
        tier = v.tier;
        slot = v.slot;
        expired = v.expired === true;
        maxVer = v.maxVer ?? null;
      }
    }
    audit({ action: 'verify', store: canonicalStoreName(store), hwid: hwid ?? undefined, ok: valid });
    res.json({ store: canonicalStoreName(store), hwid, valid, format, tier, slot, expired, maxVer });
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

  /**
   * Mint a single-use offline unlock code (ADR-050 P3): `UL-<json>.<sig>`
   * over (hwid||counter||exp||scope). Audit-only by design: codes are
   * grants, not licenses, so they stay out of the revenue ledger.
   * The operator reads the client's CURRENT counter off its licence screen
   * and mints counter+1 (replay of a consumed counter is refused).
   */
  app.post('/api/desk/unlock/issue', needToken, async (req, res) => {
    const { hwid: rawHwid, scope: rawScope, days: rawDays, counter: rawCounter } = (req.body ?? {}) as {
      hwid?: unknown; scope?: unknown; days?: unknown; counter?: unknown;
    };
    const hwid = typeof rawHwid === 'string' ? canonicalizeHwid(rawHwid) : null;
    if (!hwid) {
      res.status(400).json({ error: 'HWID غير صالح — الصيغة BM-XXXX-XXXX-XXXX-XXXX.' });
      return;
    }
    if (rawScope !== 'tamper' && rawScope !== 'drift' && rawScope !== 'emergency') {
      res.status(400).json({ error: 'النطاق: tamper (عبث ساعة) أو drift (انحراف بصمة) أو emergency (طوارئ).' });
      return;
    }
    const scope = rawScope as UnlockScope;
    const days = rawDays === undefined ? 7 : Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      res.status(400).json({ error: 'المدة 1–30 يوماً (الافتراضي 7).' });
      return;
    }
    const counter = rawCounter === undefined ? 1 : Number(rawCounter);
    if (!Number.isInteger(counter) || counter < 1) {
      res.status(400).json({ error: 'العداد عدد صحيح ≥ 1 (خذ التالي بعد عداد الزبون).' });
      return;
    }
    const { key, source } = keySource();
    if (!key) {
      audit({ action: 'unlock', hwid, ok: false, detail: 'private key missing' });
      res.status(503).json({ error: `المفتاح الخاص غير متوفر (${source}).` });
      return;
    }
    const nowMs = Date.now();
    const token = { hwid, counter, exp: nowMs + days * 86400000, scope };
    const sig = sign(null, Buffer.from(buildUnlockPayload(token)), key).toString('base64url');
    const code = formatUnlockToken(token, sig);
    if (!((await verifyUnlock(code, hwid, counter - 1, nowMs)).ok)) {
      audit({ action: 'unlock', hwid, ok: false, detail: 'SELF-CHECK FAILED' });
      res.status(500).json({ error: 'SELF-CHECK FAILED — الرمز لا يتحقق ذاتياً. توقف فوري.' });
      return;
    }
    audit({ action: 'unlock', hwid, ok: true, detail: `${scope} #${counter} (${days}d)` });
    res.json({ code, hwid, scope, counter, exp: token.exp });
  });

  /**
   * Atomic replacement (ADR-050 transfer): retire #oldSeq AND issue the new
   * HWID as one adjacent pair — no window with two active fingerprints.
   * The UI replacement flow calls this instead of issue-then-revoke.
   */
  app.post('/api/desk/transfer', needToken, async (req, res) => {
    const { oldSeq: rawOld, newHwid: rawNew, force, format: rawFormat, v2: rawV2 } = (req.body ?? {}) as {
      oldSeq?: unknown; newHwid?: unknown; force?: unknown; format?: unknown; v2?: unknown;
    };
    const oldSeq = Number(rawOld);
    if (!Number.isInteger(oldSeq) || oldSeq < 1) {
      res.status(400).json({ error: 'رقم الإصدار القديم (oldSeq) مطلوب.' });
      return;
    }
    const newHwid = typeof rawNew === 'string' ? canonicalizeHwid(rawNew) : null;
    if (!newHwid) {
      res.status(400).json({ error: 'البصمة الجديدة غير صالحة — الصيغة BM-XXXX-XXXX-XXXX-XXXX.' });
      return;
    }
    const format: MintFormat = rawFormat === 'v2' ? 'v2' : 'v1';
    const v2raw = (typeof rawV2 === 'object' && rawV2 !== null ? rawV2 : {}) as {
      tier?: unknown; expires?: unknown; maxVer?: unknown; hwid2?: unknown;
    };
    try {
      const out = await withLedgerLock(async () => {
        const entries = readLedger();
        const target = entries.find(e => e.seq === oldSeq && e.kind === 'issue');
        if (!target) {
          res.status(404).json({ error: `لا يوجد إصدار بالرقم #${oldSeq}.` });
          return null;
        }
        if (findActiveIssue(entries, target.store, target.hwid)?.seq !== oldSeq) {
          res.status(409).json({ error: `الإصدار #${oldSeq} ملغي مسبقاً أو مستبدَل.` });
          return null;
        }
        if (newHwid === target.hwid) {
          res.status(400).json({ error: 'البصمة الجديدة مطابقة للقديمة — للنقل يجب أن تختلف (وللتجديد استخدم توليد + تجاوز).' });
          return null;
        }
        const dup = findActiveIssue(entries, target.store, newHwid);
        if (dup && force !== true) {
          res.status(409).json({ error: `البصمة الجديدة مفعّلة مسبقاً (#${dup.seq}). أكّد التجاوز.`, existingSeq: dup.seq });
          return null;
        }
        const { key, source } = keySource();
        if (!key) {
          audit({ action: 'transfer', store: target.store, hwid: newHwid, ok: false, detail: 'private key missing' });
          res.status(503).json({ error: `المفتاح الخاص غير متوفر (${source}).` });
          return null;
        }
        const nowMs = Date.now();
        let minted: { key: string; v2: V2MintInfo | null };
        try {
          minted = await mintLicenseKey({ store: target.store, hwid1: newHwid, format, ...v2raw, key, nowMs });
        } catch (e) {
          if (e instanceof DeskHttpError) {
            res.status(e.status).json({ error: e.message });
            return null;
          }
          throw e;
        }
        if (!(await selfCheckOk(target.store, newHwid, minted.key, format, nowMs))) {
          audit({ action: 'transfer', store: target.store, hwid: newHwid, ok: false, detail: 'SELF-CHECK FAILED' });
          res.status(500).json({ error: 'SELF-CHECK FAILED — المفتاح لا يتحقق ذاتياً. توقف فوري، لا توزع.' });
          return null;
        }
        try {
          const { revoke, issue } = ledgerTransfer(entries, {
            ts: new Date(nowMs).toISOString(), store: target.store, oldSeq,
            newHwid, newKey: minted.key, note: `transfer #${oldSeq} → new HWID (operator)`,
          });
          writeEntry(revoke);
          writeEntry(issue);
          audit({ action: 'transfer', store: target.store, hwid: newHwid, seq: issue.seq, ok: true, detail: `retired #${oldSeq}` });
          return { revoke, issue, v2: minted.v2 };
        } catch (e) {
          audit({ action: 'transfer', store: target.store, hwid: newHwid, ok: false, detail: `ledger write failed: ${(e as Error).message}` });
          res.status(500).json({ error: `تعذر الكتابة في السجل: ${(e as Error).message}` });
          return null;
        }
      });
      if (out) res.json({
        store: out.issue.store, oldSeq, newHwid,
        revokeSeq: out.revoke.seq, issue: {
          key: out.issue.key, seq: out.issue.seq, ts: out.issue.ts,
        },
        priceDzd: LICENSE_PRICE_DZD, format, v2: out.v2,
      });
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
    // Net = pairs whose LATEST row is an issue (replacements/duplicates excluded).
    const lastByPair = new Map<string, 'issue' | 'revoke'>();
    for (const e of entries) {
      if (e.kind === 'issue') lastByPair.set(`${e.store}||${e.hwid}`, 'issue');
      else if (e.revokes !== undefined) {
        const target = entries.find(x => x.seq === e.revokes);
        if (target) lastByPair.set(`${target.store}||${target.hwid}`, 'revoke');
      }
    }
    let netIssued = 0;
    for (const v of lastByPair.values()) if (v === 'issue') netIssued++;
    res.json({
      issued, revoked,
      revenueDzd: issued * LICENSE_PRICE_DZD,
      netIssued, netRevenueDzd: netIssued * LICENSE_PRICE_DZD,
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
