/**
 * Baraka Activation Desk — staff station UI (Arabic RTL, elegant dark).
 * Signing stays server-side (`server/desk.ts`, localhost only); this screen
 * only collects store/HWID and displays issued keys + the tamper-evident
 * ledger. Crypto core is untouched (ADR-002 FROZEN).
 *
 * @module desk/DeskApp
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyRound, ShieldCheck, ShieldAlert, ScrollText, Fingerprint, Copy, Check,
  Printer, Download, RefreshCw, Ban, Search, Lock, MessageCircle, Store,
  Landmark, TriangleAlert, KeySquare, BadgeCheck, Loader2, ServerOff,
  LayoutDashboard, Users, FileCheck, Eye, EyeOff, X, FileUp, Phone,
  MapPin, Banknote, Repeat, History, ChevronDown, LogOut, Keyboard,
} from 'lucide-react';
import {
  deskApi, buildShopMessage, copyText, groupActivationKey, maskActivationKey,
  setDeskToken, clearDeskToken, getDeskToken, setUnauthorizedHandler, DeskApiError,
  type DeskHealth, type GenerateResult, type LedgerEntryDto, type DeskStats,
  type AuditEntryDto, type GenerateMeta,
} from './api';
import { canonicalizeHwid } from '../core/activation-desk';
import { canonicalStoreName } from '../core/licensing';

type Tab = 'dashboard' | 'generate' | 'verify' | 'shops' | 'ledger' | 'audit';

const GOLD = 'text-[#d4af37]';
const card = 'rounded-2xl border border-[#1e293b] bg-[#111722] shadow-[0_18px_50px_-20px_rgba(0,0,0,0.7)]';
const inputCls =
  'w-full rounded-xl border border-[#233145] bg-[#0b0f17] px-4 py-3 text-[15px] text-slate-100 ' +
  'placeholder:text-slate-600 outline-none transition focus:border-[#d4af37]/70 focus:ring-2 focus:ring-[#d4af37]/20';
const monoLtr = 'font-mono text-left tracking-wide [font-family:"JetBrains_Mono",monospace]';
const labelCls = 'mb-1.5 block text-[13px] font-bold text-slate-300';

function CopyBtn({ id, text, title, compact = false }: { id: string; text: string; title: string; compact?: boolean }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  return (
    <button
      type="button"
      title={title}
      onClick={() => {
        void copyText(text).then(ok => {
          if (ok) {
            setCopiedId(id);
            window.setTimeout(() => setCopiedId(null), 1600);
          }
        });
      }}
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#233145] bg-[#0b0f17] font-bold text-slate-300 transition hover:border-[#d4af37]/60 hover:text-[#d4af37] ${compact ? 'px-1.5 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'}`}
    >
      {copiedId === id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      {!compact && (copiedId === id ? 'تم النسخ' : 'نسخ')}
      {compact && copiedId === id && '✓'}
    </button>
  );
}

function Field({ label, value, mono = false, copyId, copyTitle = 'نسخ' }: {
  label: string; value: string; mono?: boolean; copyId?: string; copyTitle?: string;
}) {
  return (
    <div className="rounded-xl border border-[#233145] bg-[#0b0f17] p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        {copyId && <CopyBtn id={copyId} text={value} title={copyTitle} />}
      </div>
      <div dir={mono ? 'ltr' : 'auto'} className={`break-all text-[14px] font-semibold text-slate-100 ${mono ? monoLtr : ''}`}>
        {value}
      </div>
    </div>
  );
}

function ChainPill({ brokenAt }: { brokenAt: number | null }) {
  return brokenAt === null ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">
      <ShieldCheck size={14} /> السلسلة سليمة
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/50 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300">
      <TriangleAlert size={14} /> كسر عند #{brokenAt}
    </span>
  );
}

/* ── Toasts (in-app, replaces window.alert) ─────────────────────── */
export interface Toast { id: number; kind: 'ok' | 'err' | 'info'; text: string; }
let toastSeq = 1;
function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-[90] flex w-80 max-w-[calc(100vw-2.5rem)] flex-col gap-2">
      {toasts.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto flex items-start gap-2 rounded-xl border p-3 text-right text-[13px] font-bold shadow-2xl backdrop-blur transition ${
            t.kind === 'ok'
              ? 'border-emerald-500/50 bg-emerald-950/90 text-emerald-200'
              : t.kind === 'err'
                ? 'border-red-500/50 bg-red-950/90 text-red-200'
                : 'border-[#d4af37]/50 bg-[#141a08]/95 text-[#e8c85a]'
          }`}
        >
          {t.kind === 'ok' ? <Check size={16} className="mt-0.5 shrink-0" />
            : t.kind === 'err' ? <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              : <MessageCircle size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{t.text}</span>
          <X size={14} className="mt-0.5 shrink-0 opacity-60" />
        </button>
      ))}
    </div>
  );
}

/* ── Modal (in-app confirm, replaces window.confirm) ─────────────── */
function Modal({ title, children, onClose, actions }: {
  title: string; children: React.ReactNode; onClose: () => void; actions: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`${card} w-full max-w-lg p-5`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-extrabold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق"
            className="rounded-lg p-1 text-slate-500 transition hover:bg-white/5 hover:text-slate-200">
            <X size={18} />
          </button>
        </div>
        <div className="text-sm leading-relaxed text-slate-300">{children}</div>
        <div className="mt-4 flex justify-start gap-2">{actions}</div>
      </div>
    </div>
  );
}

const btnGold =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#d4af37] to-[#b08d2a] px-4 py-2.5 text-sm font-extrabold text-[#0b0f17] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const btnGhost =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-[#233145] bg-[#0b0f17] px-4 py-2.5 text-sm font-bold text-slate-300 transition hover:border-slate-500 hover:text-slate-100';
const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-red-500 to-red-700 px-4 py-2.5 text-sm font-extrabold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

/* ── Masked activation key with reveal (shoulder-surfing protection) ─ */
function MaskedKey({ value, id }: { value: string; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5" dir="ltr">
      <span className={`${monoLtr} text-[11px] ${open ? 'text-slate-200' : 'text-slate-500'}`} title={open ? value : 'مقنّع — انقر للعرض'}>
        {open ? value : maskActivationKey(value)}
      </span>
      <button type="button" onClick={() => setOpen(o => !o)} title={open ? 'إخفاء' : 'عرض'}
        className="rounded p-0.5 text-slate-500 transition hover:text-[#d4af37]">
        {open ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <CopyBtn id={id} text={value} title="نسخ المفتاح الكامل" compact />
    </span>
  );
}

/* ── Monthly issuance chart (pure SVG, no dependencies) ──────────── */
function MonthChart({ entries }: { entries: LedgerEntryDto[] }) {
  const buckets = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.kind !== 'issue') continue;
      const d = new Date(e.ts);
      if (Number.isNaN(d.getTime())) continue;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    const keys = [...map.keys()].sort().slice(-12);
    const max = Math.max(1, ...keys.map(k => map.get(k) ?? 0));
    return { keys, max, get: (k: string) => map.get(k) ?? 0 };
  }, [entries]);
  if (buckets.keys.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-500">لا بيانات بعد — يظهر المنحنى مع أول إصدار.</p>;
  }
  const W = 560;
  const H = 150;
  const PAD = 26;
  const bw = (W - PAD * 2) / buckets.keys.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="منحنى الإصدارات الشهرية">
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={PAD} x2={W - PAD} y1={H - PAD - (H - PAD * 2) * f} y2={H - PAD - (H - PAD * 2) * f}
          stroke="#1e293b" strokeDasharray="3 4" />
      ))}
      {buckets.keys.map((k, i) => {
        const v = buckets.get(k);
        const h = Math.max(3, ((H - PAD * 2) * v) / buckets.max);
        const x = PAD + i * bw + bw * 0.22;
        const y = H - PAD - h;
        const [, mm] = k.split('-');
        return (
          <g key={k}>
            <rect x={x} y={y} width={bw * 0.56} height={h} rx={4}
              fill="url(#deskGold)" opacity={i === buckets.keys.length - 1 ? 1 : 0.55}>
              <title>{`${k}: ${v}`}</title>
            </rect>
            <text x={x + bw * 0.28} y={y - 5} textAnchor="middle" fontSize={11} fontWeight={800} fill="#e8c85a">{v}</text>
            <text x={x + bw * 0.28} y={H - 10} textAnchor="middle" fontSize={10} fill="#64748b">{mm}</text>
          </g>
        );
      })}
      <defs>
        <linearGradient id="deskGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3d97b" />
          <stop offset="1" stopColor="#8a6d1c" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Shop directory aggregation (derived from the ledger, no new store) */
export interface ShopInfo {
  store: string;
  issues: LedgerEntryDto[];
  activeHwids: string[];
  phones: string[];
  wilayas: string[];
  firstTs: string;
  lastTs: string;
  paidTotal: number;
}

function buildShops(entries: LedgerEntryDto[]): ShopInfo[] {
  const revoked = new Set<string>();
  for (const e of entries) {
    if (e.kind === 'revoke') {
      if (typeof e.revokes === 'number') revoked.add(`seq:${e.revokes}`);
      else if (e.key) revoked.add(`key:${e.key}`);
    }
  }
  const byStore = new Map<string, LedgerEntryDto[]>();
  for (const e of entries) {
    if (e.kind !== 'issue') continue;
    const list = byStore.get(e.store) ?? [];
    list.push(e);
    byStore.set(e.store, list);
  }
  const out: ShopInfo[] = [];
  for (const [store, issues] of byStore) {
    const sorted = [...issues].sort((a, b) => a.seq - b.seq);
    const activeHwids = [...new Set(
      sorted.filter(e => !revoked.has(`seq:${e.seq}`) && !revoked.has(`key:${e.key}`)).map(e => e.hwid),
    )];
    const phones = [...new Set(sorted.map(e => e.meta?.phone).filter((x): x is string => !!x))];
    const wilayas = [...new Set(sorted.map(e => e.meta?.wilaya).filter((x): x is string => !!x))];
    out.push({
      store,
      issues: sorted,
      activeHwids,
      phones,
      wilayas,
      firstTs: sorted[0].ts,
      lastTs: sorted[sorted.length - 1].ts,
      paidTotal: sorted.reduce((s, e) => s + (e.meta?.paidDzd ?? 0), 0),
    });
  }
  return out.sort((a, b) => b.lastTs.localeCompare(a.lastTs));
}

/** Active (non-revoked) issue lookup for the duplicate pre-check. */
function findActiveLocal(entries: LedgerEntryDto[], store: string, hwid: string): LedgerEntryDto | null {
  const canon = canonicalStoreName(store);
  const chwid = canonicalizeHwid(hwid);
  if (!chwid) return null;
  const revokedSeq = new Set<number>();
  const revokedKey = new Set<string>();
  for (const e of entries) {
    if (e.kind !== 'revoke') continue;
    if (typeof e.revokes === 'number') revokedSeq.add(e.revokes);
    else {
      const m = /→ #(\d+)/.exec(e.note ?? '');
      if (m) revokedSeq.add(Number(m[1]));
      if (e.key) revokedKey.add(e.key);
    }
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === 'issue' && e.store === canon && e.hwid === chwid &&
      !revokedSeq.has(e.seq) && !revokedKey.has(e.key)) return e;
  }
  return null;
}

const PRINT_CSS = `
@media print {
  body { background: #fff !important; }
  body * { visibility: hidden; }
  #desk-print-area, #desk-print-area * { visibility: visible; }
  #desk-print-area { display: block !important; position: absolute; inset: 0; padding: 24px; color: #000; background: #fff; }
  #desk-print-area .pr-card { border: 2px solid #000; border-radius: 12px; padding: 20px; max-width: 560px; margin: 0 auto; }
  #desk-print-area h2 { font-size: 20px; margin: 0 0 4px; }
  #desk-print-area table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
  #desk-print-area td { border: 1px solid #000; padding: 8px 10px; }
  #desk-print-area td.k { font-weight: bold; width: 130px; background: #f0f0f0; }
  #desk-print-area .mono { font-family: monospace; direction: ltr; text-align: left; }
  #desk-print-area .sign { display: flex; gap: 32px; margin-top: 36px; }
  #desk-print-area .sign div { flex: 1; border-top: 1px solid #000; padding-top: 6px; font-size: 12px; }
}
`;

export function DeskApp() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [health, setHealth] = useState<DeskHealth | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [localHwid, setLocalHwid] = useState<string>('');
  const [stats, setStats] = useState<DeskStats | null>(null);
  const [locked, setLocked] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  // toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismissToast = useCallback((id: number) => {
    setToasts(ts => ts.filter(t => t.id !== id));
  }, []);
  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = toastSeq++;
    setToasts(ts => [...ts.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 4200);
  }, []);

  // generate form
  const [gStore, setGStore] = useState('');
  const [gHwid, setGHwid] = useState('');
  const [gPhone, setGPhone] = useState('');
  const [gWilaya, setGWilaya] = useState('');
  const [gPaid, setGPaid] = useState('');
  const [gNote, setGNote] = useState('');
  const [gMetaOpen, setGMetaOpen] = useState(false);
  const [gBusy, setGBusy] = useState(false);
  const [gErr, setGErr] = useState<string | null>(null);
  const [gResult, setGResult] = useState<GenerateResult | null>(null);
  const [confirmSign, setConfirmSign] = useState(false);
  const [forceDup, setForceDup] = useState(false);
  const [replaceCtx, setReplaceCtx] = useState<{ oldSeq: number; store: string } | null>(null);

  // verify form
  const [vStore, setVStore] = useState('');
  const [vHwid, setVHwid] = useState('');
  const [vKey, setVKey] = useState('');
  const [vBusy, setVBusy] = useState(false);
  const [vResult, setVResult] = useState<{ valid: boolean } | null>(null);

  // ledger
  const [entries, setEntries] = useState<LedgerEntryDto[]>([]);
  const [ledgerCount, setLedgerCount] = useState(0);
  const [brokenAt, setBrokenAt] = useState<number | null>(null);
  const [priceDzd, setPriceDzd] = useState(5000);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<{ seq: number; store: string; hwid: string } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ count: number; brokenAt: number | null } | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // shops + audit
  const [shopSearch, setShopSearch] = useState('');
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [auditRows, setAuditRows] = useState<AuditEntryDto[]>([]);
  const [auditCount, setAuditCount] = useState(0);

  const refreshAll = useCallback(async () => {
    try {
      const [h, s, l] = await Promise.all([deskApi.health(), deskApi.stats(), deskApi.ledger(500)]);
      setHealth(h);
      setHealthErr(null);
      setStats(s);
      setPriceDzd(s.priceDzd || h.priceDzd || 5000);
      setEntries(l.entries.slice().reverse());
      setLedgerCount(l.count);
      setBrokenAt(l.brokenAt);
      if (l.priceDzd) setPriceDzd(l.priceDzd);
    } catch (e) {
      if (e instanceof DeskApiError && e.status === 401) return; // unlock screen handles it
      setHealthErr(e instanceof Error ? e.message : 'تعذر الاتصال بخادم المكتب. شغّل: npm run desk');
    }
  }, []);

  const refreshAudit = useCallback(async () => {
    try {
      const a = await deskApi.audit(200);
      setAuditRows(a.entries.slice().reverse());
      setAuditCount(a.count);
    } catch {
      /* audit view is best-effort */
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setLocked(true));
    setLocked(!getDeskToken());
    void refreshAll();
    deskApi.hwid().then(r => setLocalHwid(r.hwid)).catch(() => undefined);
    return () => setUnauthorizedHandler(null);
  }, [refreshAll]);

  // Alt+1..6 tab shortcuts (keyboard-first operation)
  useEffect(() => {
    const order: Tab[] = ['dashboard', 'generate', 'verify', 'shops', 'ledger', 'audit'];
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= order.length) {
        e.preventDefault();
        setTab(order[n - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const unlock = useCallback(() => {
    if (!tokenInput.trim()) return;
    setDeskToken(tokenInput);
    setTokenInput('');
    setLocked(false);
    pushToast('ok', 'تم فتح المحطة — رمز المشغّل مقبول.');
    void refreshAll();
    void refreshAudit();
  }, [tokenInput, pushToast, refreshAll, refreshAudit]);

  const lock = useCallback(() => {
    clearDeskToken();
    setLocked(true);
  }, []);

  const gHwidState = useMemo(() => {
    if (!gHwid.trim()) return { ok: null as boolean | null, canon: null as string | null };
    const canon = canonicalizeHwid(gHwid);
    return { ok: canon !== null, canon };
  }, [gHwid]);

  const dupLocal = useMemo(
    () => (gStore.trim() && gHwidState.canon ? findActiveLocal(entries, gStore, gHwidState.canon) : null),
    [entries, gStore, gHwidState.canon],
  );

  const buildMeta = useCallback((): GenerateMeta | undefined => {
    const meta: GenerateMeta = {};
    if (gPhone.trim()) meta.phone = gPhone.trim().slice(0, 32);
    if (gWilaya.trim()) meta.wilaya = gWilaya.trim().slice(0, 64);
    if (gNote.trim()) meta.note = gNote.trim().slice(0, 200);
    const paid = Number(gPaid.replace(/[^0-9]/g, ''));
    if (gPaid.trim() && Number.isFinite(paid) && paid >= 0) meta.paidDzd = Math.floor(paid);
    return Object.keys(meta).length > 0 ? meta : undefined;
  }, [gPhone, gWilaya, gNote, gPaid]);

  const runGenerate = useCallback(async (force: boolean) => {
    setGBusy(true);
    setGErr(null);
    try {
      const r = await deskApi.generate(gStore, gHwid, buildMeta(), force || undefined);
      setGResult(r);
      setConfirmSign(false);
      setForceDup(false);
      pushToast('ok', `تم إصدار المفتاح #${r.seq} — تحقق ذاتي سليم.`);
      // Replacement flow: the new key is issued — now retire the old one.
      if (replaceCtx) {
        const ctx = replaceCtx;
        setReplaceCtx(null);
        setRevokeTarget({ seq: ctx.oldSeq, store: ctx.store, hwid: '' });
      }
      void refreshAll();
    } catch (e) {
      if (e instanceof DeskApiError && e.status === 409) {
        setGErr(e.message);
        setConfirmSign(false);
        pushToast('err', e.message);
      } else if (e instanceof DeskApiError && e.status === 401) {
        setConfirmSign(false);
      } else {
        setGErr(e instanceof Error ? e.message : 'فشل التوليد');
      }
    } finally {
      setGBusy(false);
    }
  }, [gStore, gHwid, buildMeta, pushToast, refreshAll, replaceCtx]);

  const doVerify = useCallback(async () => {
    setVBusy(true);
    setVResult(null);
    try {
      const r = await deskApi.verify(vStore, vHwid, vKey);
      setVResult({ valid: r.valid });
    } catch {
      setVResult({ valid: false });
    } finally {
      setVBusy(false);
    }
  }, [vStore, vHwid, vKey]);

  const doRevoke = useCallback(async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await deskApi.revoke(revokeTarget.seq);
      pushToast('ok', `تم إلغاء الإصدار #${revokeTarget.seq} (مرجع طاقم — استبدله ببصمة جديدة).`);
      setRevokeTarget(null);
      await refreshAll();
    } catch (e) {
      pushToast('err', e instanceof Error ? e.message : 'فشل الإلغاء');
    } finally {
      setRevoking(false);
    }
  }, [revokeTarget, pushToast, refreshAll]);

  const doCsv = useCallback(() => {
    const rows = ['seq,ts,kind,store,hwid,phone,wilaya,price_dzd'];
    for (const e of [...entries].reverse()) {
      rows.push(
        `${e.seq},${e.ts},${e.kind},"${e.store.replace(/"/g, '""')}",${e.hwid},` +
        `"${(e.meta?.phone ?? '').replace(/"/g, '""')}","${(e.meta?.wilaya ?? '').replace(/"/g, '""')}",${e.kind === 'issue' ? priceDzd : 0}`,
      );
    }
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'keygen-ledger.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    pushToast('ok', 'تم تصدير CSV للمحاسبة.');
  }, [entries, priceDzd, pushToast]);

  const doJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(entries.slice().reverse(), null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'keygen-ledger-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
    pushToast('ok', 'تم تنزيل نسخة JSON من السجل.');
  }, [entries, pushToast]);

  const doCheckFile = useCallback(async (file: File) => {
    setCheckResult(null);
    setCheckErr(null);
    try {
      const text = await file.text();
      const r = await deskApi.ledgerCheck(text);
      setCheckResult(r);
      pushToast(r.brokenAt === null ? 'ok' : 'err',
        r.brokenAt === null ? `الملف سليم — ${r.count} سطراً.` : `الملف مكسور عند #${r.brokenAt}.`);
    } catch (e) {
      setCheckErr(e instanceof Error ? e.message : 'تعذر فحص الملف');
    }
  }, [pushToast]);

  const startReplace = useCallback((oldSeq: number, store: string) => {
    setGStore(store);
    setGHwid('');
    setGResult(null);
    setGErr(null);
    setForceDup(false);
    setReplaceCtx({ oldSeq, store });
    setTab('generate');
    pushToast('info', `وضع الاستبدال: أدخل البصمة الجديدة لمحل "${store}" — سيُطلب إلغاء #${oldSeq} بعد الإصدار.`);
  }, [pushToast]);

  const shops = useMemo(() => buildShops(entries), [entries]);
  const filteredShops = useMemo(() => {
    const q = shopSearch.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter(s =>
      s.store.toLowerCase().includes(q) ||
      s.phones.some(p => p.includes(q)) ||
      s.wilayas.some(w => w.toLowerCase().includes(q)) ||
      s.activeHwids.some(h => h.toLowerCase().includes(q)),
    );
  }, [shops, shopSearch]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      e.store.toLowerCase().includes(q) || e.hwid.toLowerCase().includes(q) || String(e.seq).includes(q),
    );
  }, [entries, search]);

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; hint: string }> = [
    { id: 'dashboard', label: 'اللوحة', icon: <LayoutDashboard size={17} />, hint: 'Alt+1' },
    { id: 'generate', label: 'توليد مفتاح', icon: <KeyRound size={17} />, hint: 'Alt+2' },
    { id: 'verify', label: 'تحقق', icon: <BadgeCheck size={17} />, hint: 'Alt+3' },
    { id: 'shops', label: `المحلات (${shops.length})`, icon: <Users size={17} />, hint: 'Alt+4' },
    { id: 'ledger', label: `السجل (${ledgerCount})`, icon: <ScrollText size={17} />, hint: 'Alt+5' },
    { id: 'audit', label: 'التدقيق', icon: <History size={17} />, hint: 'Alt+6' },
  ];

  return (
    <div className="min-h-screen bg-[#0b0f17] font-[Cairo] text-slate-100 antialiased" dir="rtl">
      <style>{PRINT_CSS}</style>
      <ToastStack toasts={toasts} dismiss={dismissToast} />
      {/* golden top hairline */}
      <div className="h-1 bg-gradient-to-l from-[#d4af37] via-[#f3d97b] to-[#d4af37]" />

      {/* ── Unlock screen (operator token gate) ────────── */}
      {locked && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0b0f17]/95 p-4 backdrop-blur">
          <div className={`${card} w-full max-w-md p-6 text-center`}>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#d4af37] to-[#8a6d1c]">
              <Lock size={26} className="text-[#0b0f17]" />
            </div>
            <h2 className="text-lg font-extrabold">محطة مقفلة — رمز المشغّل</h2>
            <p className="mx-auto mt-1 max-w-80 text-xs leading-relaxed text-slate-400">
              الصق الرمز الظاهر في طرفية الخادم (<span className="font-mono" dir="ltr">operator token</span>).
              يُحفظ لجلسة المتصفح فقط — احذف <span className="font-mono" dir="ltr">.desk-token</span> للتدوير.
            </p>
            <input
              type="password"
              className={`${inputCls} ${monoLtr} mt-4`}
              dir="ltr"
              placeholder="64 hex chars…"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value.trim())}
              onKeyDown={e => { if (e.key === 'Enter') unlock(); }}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button type="button" onClick={unlock} disabled={!tokenInput.trim()} className={`${btnGold} mt-3 w-full`}>
              <KeySquare size={17} /> فتح المحطة
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {/* ── Header ─────────────────────────────── */}
        <header className="flex flex-wrap items-center gap-4 py-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#d4af37] to-[#8a6d1c] shadow-[0_10px_30px_-8px_rgba(212,175,55,0.5)]">
            <KeySquare size={28} className="text-[#0b0f17]" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight">
              مكتب التفعيل <span className={GOLD}>Baraka</span>
            </h1>
            <p className="mt-0.5 text-[13px] text-slate-400">
              محطة الطاقم لتوقيع التراخيص — Ed25519 دون اتصال · للطاقم فقط
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {health ? <ChainPill brokenAt={health.ledgerBrokenAt} /> : null}
            {health && health.backupCount === health.ledgerCount && health.ledgerCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-300">
                <FileCheck size={13} /> نسخة احتياطية: سليمة
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
              health?.keyLoaded
                ? 'border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c85a]'
                : 'border-red-500/50 bg-red-500/10 text-red-300'
            }`}>
              <Lock size={13} />
              {health ? (health.keyLoaded ? 'المفتاح الخاص جاهز' : 'المفتاح الخاص مفقود') : '…'}
            </span>
            {!locked && (
              <button type="button" onClick={lock} title="قفل المحطة (يمسح الرمز من الجلسة)"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#233145] bg-[#0b0f17] px-3 py-1 text-xs font-bold text-slate-400 transition hover:border-red-500/60 hover:text-red-300">
                <LogOut size={13} /> قفل
              </button>
            )}
          </div>
        </header>

        {healthErr && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
            <ServerOff size={20} className="mt-0.5 shrink-0 text-red-300" />
            <div>
              <div className="font-extrabold text-red-200">خادم المكتب لا يستجيب</div>
              <div className="mt-1 font-mono text-xs text-red-300/80" dir="ltr">{healthErr}</div>
              <div className="mt-2 text-[13px] text-red-200/90">
                شغّل في طرفية ثانية: <span className="font-mono font-bold" dir="ltr">npm run desk</span> ثم حدّث الصفحة.
              </div>
              <button type="button" onClick={() => void refreshAll()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-bold text-red-100 transition hover:bg-red-500/30">
                <RefreshCw size={13} /> إعادة المحاولة
              </button>
            </div>
          </div>
        )}

        {health?.keyLoaded === false && (
          <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <span className="font-extrabold">تنبيه:</span> {health.keySource} — ضع الملف بجانب التطبيق أو عرّف
            <span className="font-mono" dir="ltr"> BARAKA_PRIVATE_KEY </span> ثم أعد تشغيل الخادم.
          </div>
        )}

        {health?.keyPermWarn && (
          <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <span className="font-extrabold">تحذير صلاحيات:</span> {health.keyPermWarn}
          </div>
        )}

        {/* ── Stats ──────────────────────────────── */}
        <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'مفاتيح مصدَرة', value: stats ? String(stats.issued) : '—', icon: <KeyRound size={18} />, accent: GOLD },
            { label: `إيراد (${priceDzd.toLocaleString('fr-FR')} دج / مفتاح)`, value: stats ? `${stats.revenueDzd.toLocaleString('fr-FR')} دج` : '—', icon: <Landmark size={18} />, accent: 'text-emerald-300' },
            { label: 'ملغاة (مرجع طاقم)', value: stats ? String(stats.revoked) : '—', icon: <Ban size={18} />, accent: 'text-slate-300' },
            { label: 'بصمة هذا الجهاز', value: localHwid || '…', icon: <Fingerprint size={18} />, accent: 'text-sky-300', mono: true },
          ].map(s => (
            <div key={s.label} className={`${card} flex items-center gap-3 p-4`}>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0b0f17] ${s.accent}`}>{s.icon}</div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-500">{s.label}</div>
                <div className={`truncate text-lg font-extrabold ${s.mono ? `${monoLtr} text-[13px]` : ''}`} dir={s.mono ? 'ltr' : 'auto'} title={s.value}>
                  {s.value}
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* ── Tabs ───────────────────────────────── */}
        <nav className={`${card} mb-5 flex gap-1 overflow-x-auto p-1.5`}>
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              title={t.hint}
              onClick={() => { setTab(t.id); if (t.id === 'audit') void refreshAudit(); }}
              className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-extrabold transition ${
                tab === t.id
                  ? 'bg-gradient-to-b from-[#d4af37] to-[#b08d2a] text-[#0b0f17] shadow'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <p className="mb-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-600">
          <Keyboard size={12} /> اختصارات: Alt+1 … Alt+6 للتنقل بين الأقسام
        </p>

        {/* ── Dashboard ──────────────────────────── */}
        {tab === 'dashboard' && (
          <section className="grid gap-4 lg:grid-cols-5">
            <div className={`${card} p-5 lg:col-span-3`}>
              <h2 className="mb-1 flex items-center gap-2 text-base font-extrabold">
                <LayoutDashboard size={17} className={GOLD} /> منحنى الإصدارات الشهرية
              </h2>
              <p className="mb-3 text-xs text-slate-500">آخر 12 شهراً — من سجل الإصدارات مباشرة.</p>
              <MonthChart entries={entries} />
            </div>
            <div className={`${card} p-5 lg:col-span-2`}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold">
                <History size={17} className={GOLD} /> أحدث الإصدارات
              </h2>
              {entries.filter(e => e.kind === 'issue').length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">لا إصدارات بعد.</p>
              ) : (
                <ul className="space-y-2">
                  {entries.filter(e => e.kind === 'issue').slice(0, 5).map(e => (
                    <li key={e.seq} className="flex items-center gap-2 rounded-xl border border-[#233145] bg-[#0b0f17] px-3 py-2 text-[13px]">
                      <span className="font-mono font-bold text-[#e8c85a]" dir="ltr">#{e.seq}</span>
                      <span className="min-w-0 flex-1 truncate font-bold" title={e.store}>{e.store}</span>
                      <span className="shrink-0 text-[11px] text-slate-500" dir="ltr">
                        {new Date(e.ts).toLocaleDateString('fr-FR')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setTab('generate')} className={`${btnGold} mt-4 w-full`}>
                <KeyRound size={17} /> إصدار مفتاح جديد
              </button>
            </div>
          </section>
        )}

        {/* ── Generate ───────────────────────────── */}
        {tab === 'generate' && (
          <section className="grid gap-4 lg:grid-cols-5">
            <div className={`${card} p-5 lg:col-span-2`}>
              <h2 className="mb-1 flex items-center gap-2 text-base font-extrabold">
                <Store size={17} className={GOLD} /> بيانات المحل
              </h2>
              <p className="mb-4 text-xs text-slate-500">التوقيع محلي وفوري، مع تحقق ذاتي قبل العرض — وتأكيد صريح قبل التوقيع.</p>

              {replaceCtx && (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-[13px] font-bold text-sky-200">
                  <Repeat size={16} className="mt-0.5 shrink-0" />
                  <span>
                    وضع الاستبدال لمحل «{replaceCtx.store}» — بعد إصدار البصمة الجديدة سيُطلب إلغاء #{replaceCtx.oldSeq}.
                    <button type="button" onClick={() => setReplaceCtx(null)} className="ms-2 underline underline-offset-2 hover:text-white">إلغاء الوضع</button>
                  </span>
                </div>
              )}

              <label className={labelCls} htmlFor="g-store">اسم المحل (كما هو مسجّل)</label>
              <input
                id="g-store"
                className={inputCls}
                placeholder="مثال: Epicerie Nour"
                value={gStore}
                onChange={e => setGStore(e.target.value)}
                autoComplete="off"
              />

              <div className="mt-4 flex items-center justify-between">
                <label className={labelCls} htmlFor="g-hwid" style={{ marginBottom: 0 }}>بصمة الجهاز HWID</label>
                {localHwid && (
                  <button
                    type="button"
                    onClick={() => setGHwid(localHwid)}
                    className="text-[11px] font-bold text-sky-300 underline-offset-2 hover:underline"
                  >
                    استخدام بصمة هذا الجهاز
                  </button>
                )}
              </div>
              <input
                id="g-hwid"
                className={`${inputCls} mt-1.5 ${monoLtr} ${gHwid && (gHwidState.ok ? 'border-emerald-500/60' : 'border-red-500/60')}`}
                placeholder="BM-XXXX-XXXX-XXXX-XXXX"
                value={gHwid}
                dir="ltr"
                onChange={e => setGHwid(e.target.value.toUpperCase())}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="mt-1.5 min-h-5 text-[11px] font-bold">
                {gHwid.trim() === '' ? (
                  <span className="text-slate-600">الشرطات اختيارية — تُقبل الأحرف الصغيرة.</span>
                ) : gHwidState.ok ? (
                  <span className="text-emerald-400">✓ صيغة سليمة</span>
                ) : (
                  <span className="text-red-400">✗ الصيغة: BM-XXXX-XXXX-XXXX-XXXX (ستة عشر رمزاً سداسياً)</span>
                )}
              </div>

              {/* duplicate pre-check (server enforces with 409 regardless) */}
              {dupLocal && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-200">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>إصدار نشط موجود:</strong> #{dupLocal.seq} بتاريخ {new Date(dupLocal.ts).toLocaleDateString('fr-FR')}.
                    الإصدار المكرر يتطلب تجاوزاً صريحاً ويُسجَّل في التدقيق.
                  </span>
                </div>
              )}

              {/* optional client meta (CRM-lite, carried unhashed in the ledger) */}
              <button
                type="button"
                onClick={() => setGMetaOpen(o => !o)}
                className="mt-3 flex w-full items-center justify-between rounded-xl border border-[#233145] bg-[#0b0f17] px-3 py-2 text-[13px] font-bold text-slate-300 transition hover:border-[#d4af37]/50"
              >
                <span className="flex items-center gap-1.5"><Users size={14} className={GOLD} /> بيانات العميل (اختياري)</span>
                <ChevronDown size={15} className={`transition ${gMetaOpen ? 'rotate-180' : ''}`} />
              </button>
              {gMetaOpen && (
                <div className="mt-2 grid gap-2.5 rounded-xl border border-[#233145] bg-[#0b0f17]/60 p-3">
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className={labelCls} htmlFor="g-phone"><span className="inline-flex items-center gap-1"><Phone size={12} /> الهاتف</span></label>
                      <input id="g-phone" className={inputCls} dir="ltr" placeholder="05…" value={gPhone}
                        onChange={e => setGPhone(e.target.value)} autoComplete="off" />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="g-wilaya"><span className="inline-flex items-center gap-1"><MapPin size={12} /> الولاية</span></label>
                      <input id="g-wilaya" className={inputCls} placeholder="مثال: سطيف" value={gWilaya}
                        onChange={e => setGWilaya(e.target.value)} autoComplete="off" />
                    </div>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className={labelCls} htmlFor="g-paid"><span className="inline-flex items-center gap-1"><Banknote size={12} /> المبلغ المقبوض (دج)</span></label>
                      <input id="g-paid" className={inputCls} dir="ltr" inputMode="numeric" placeholder="5000" value={gPaid}
                        onChange={e => setGPaid(e.target.value)} autoComplete="off" />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="g-note">ملاحظة</label>
                      <input id="g-note" className={inputCls} placeholder="…" value={gNote}
                        onChange={e => setGNote(e.target.value)} autoComplete="off" />
                    </div>
                  </div>
                </div>
              )}

              {dupLocal && (
                <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[13px] font-bold text-amber-100">
                  <input
                    type="checkbox"
                    checked={forceDup}
                    onChange={e => setForceDup(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#d4af37]"
                  />
                  <span>أؤكد التجاوز — إصدار مفتاح مكرر رغم وجود #{dupLocal.seq} النشط (يُسجَّل في التدقيق).</span>
                </label>
              )}

              {gErr && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-[13px] font-bold text-red-200">
                  <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {gErr}
                </div>
              )}

              <button
                type="button"
                disabled={gBusy || !gStore.trim() || !gHwidState.ok || (dupLocal !== null && !forceDup) || health?.keyLoaded === false}
                onClick={() => setConfirmSign(true)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#d4af37] to-[#b08d2a] px-4 py-3 text-[15px] font-extrabold text-[#0b0f17] shadow-[0_10px_25px_-10px_rgba(212,175,55,0.6)] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {gBusy ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
                {gBusy ? 'جارٍ التوقيع…' : 'مراجعة وتوقيع'}
              </button>
              <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                <Lock size={11} /> المفتاح الخاص لا يغادر الخادم المحلي أبداً
              </p>
            </div>

            <div className={`${card} relative overflow-hidden p-5 lg:col-span-3`}>
              <div className="pointer-events-none absolute -top-20 -left-20 h-56 w-56 rounded-full bg-[#d4af37]/10 blur-3xl" />
              <h2 className="mb-1 flex items-center gap-2 text-base font-extrabold">
                <ShieldCheck size={17} className={GOLD} /> الإيصال
                {gResult && <span className="rounded-full bg-[#d4af37]/15 px-2.5 py-0.5 text-[11px] font-bold text-[#e8c85a]">#{gResult.seq}</span>}
              </h2>
              {!gResult ? (
                <div className="flex h-[calc(100%-2.5rem)] min-h-56 flex-col items-center justify-center gap-2 text-center text-slate-500">
                  <KeyRound size={36} className="opacity-30" />
                  <p className="text-sm font-bold">لا يوجد إصدار بعد</p>
                  <p className="max-w-60 text-xs">املأ اسم المحل والبصمة ثم اضغط «مراجعة وتوقيع».</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Field label="المحل" value={gResult.store} copyId="g-store-v" />
                    <Field label="HWID" value={gResult.hwid} mono copyId="g-hwid-v" />
                  </div>
                  <div className="rounded-xl border border-[#d4af37]/40 bg-[#0b0f17] p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#e8c85a]">مفتاح التفعيل AK — صيغة الإملاء</span>
                      <span className="flex gap-1.5">
                        <CopyBtn id="g-key" text={gResult.key} title="نسخ المفتاح الخام" />
                        <CopyBtn id="g-key-g" text={groupActivationKey(gResult.key)} title="نسخ الصيغة المجزأة" />
                      </span>
                    </div>
                    <div dir="ltr" className={`${monoLtr} break-all text-[13px] font-semibold leading-relaxed text-slate-100`}>
                      {groupActivationKey(gResult.key)}
                    </div>
                  </div>
                  {(gResult.meta?.phone || gResult.meta?.wilaya || gResult.meta?.paidDzd !== undefined) && (
                    <div className="flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-400">
                      {gResult.meta?.phone && <span className="rounded-full border border-[#233145] px-2 py-0.5">📞 <span dir="ltr">{gResult.meta.phone}</span></span>}
                      {gResult.meta?.wilaya && <span className="rounded-full border border-[#233145] px-2 py-0.5">📍 {gResult.meta.wilaya}</span>}
                      {gResult.meta?.paidDzd !== undefined && <span className="rounded-full border border-[#233145] px-2 py-0.5">💰 {gResult.meta.paidDzd.toLocaleString('fr-FR')} دج</span>}
                    </div>
                  )}
                  <div className="rounded-xl border border-[#233145] bg-[#0b0f17] p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <MessageCircle size={12} /> رسالة الواتساب / SMS
                      </span>
                      <CopyBtn id="g-wa" text={buildShopMessage(gResult.store, gResult.key)} title="نسخ الرسالة" />
                    </div>
                    <p className="text-[13px] leading-relaxed text-slate-300">{buildShopMessage(gResult.store, gResult.key)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">
                      <ShieldCheck size={13} /> تحقق ذاتي: سليم
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(gResult.ts).toLocaleString('fr-FR')} · {gResult.priceDzd.toLocaleString('fr-FR')} دج
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#233145] bg-[#0b0f17] px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:border-[#d4af37]/60 hover:text-[#d4af37]"
                    >
                      <Printer size={13} /> طباعة الإيصال (عربي + فرنسي)
                    </button>
                  </div>
                  {/* print-only bilingual receipt */}
                  <div id="desk-print-area" style={{ display: 'none' }}>
                    <div className="pr-card">
                      <h2>Baraka Market — إيصال تفعيل / Reçu d'activation #{gResult.seq}</h2>
                      <table>
                        <tbody>
                          <tr><td className="k">المحل / Boutique</td><td>{gResult.store}</td></tr>
                          <tr><td className="k">HWID</td><td className="mono">{gResult.hwid}</td></tr>
                          <tr><td className="k">المفتاح / Clé</td><td className="mono">{gResult.key}</td></tr>
                          <tr><td className="k">السعر / Prix</td><td>{gResult.priceDzd.toLocaleString('fr-FR')} DZD</td></tr>
                          <tr><td className="k">التاريخ / Date</td><td>{new Date(gResult.ts).toLocaleString('fr-FR')}</td></tr>
                          {gResult.meta?.phone && <tr><td className="k">الهاتف / Tél</td><td className="mono">{gResult.meta.phone}</td></tr>}
                          {gResult.meta?.wilaya && <tr><td className="k">الولاية / Wilaya</td><td>{gResult.meta.wilaya}</td></tr>}
                        </tbody>
                      </table>
                      <p style={{ fontSize: 12, marginTop: 12 }}>الصقه في: الإعدادات ← الترخيص ← تفعيل / Collez-la dans : Paramètres ← Licence ← Activation.</p>
                      <div className="sign"><div>توقيع المشغّل / Signature</div><div>توقيع الزبون / Client</div></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Verify ─────────────────────────────── */}
        {tab === 'verify' && (
          <section className={`${card} mx-auto max-w-2xl p-5 sm:p-7`}>
            <h2 className="mb-1 flex items-center gap-2 text-base font-extrabold">
              <BadgeCheck size={17} className={GOLD} /> التحقق من مفتاح
            </h2>
            <p className="mb-4 text-xs text-slate-500">تحقق دون اتصال ضد البصمة العامة المدمجة — لا يكشف المفتاح الخاص.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="v-store">اسم المحل</label>
                <input id="v-store" className={inputCls} value={vStore} onChange={e => setVStore(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <label className={labelCls} htmlFor="v-hwid">HWID</label>
                <input id="v-hwid" className={`${inputCls} ${monoLtr}`} dir="ltr" value={vHwid}
                  onChange={e => setVHwid(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} />
              </div>
            </div>
            <div className="mt-3">
              <label className={labelCls} htmlFor="v-key">المفتاح (AK-…)</label>
              <input id="v-key" className={`${inputCls} ${monoLtr}`} dir="ltr" value={vKey}
                onChange={e => setVKey(e.target.value.trim())} autoComplete="off" spellCheck={false} placeholder="AK-…" />
            </div>
            <button
              type="button"
              disabled={vBusy || !vStore.trim() || !vHwid.trim() || !vKey.trim()}
              onClick={() => void doVerify()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#d4af37] to-[#b08d2a] px-4 py-3 text-[15px] font-extrabold text-[#0b0f17] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {vBusy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
              تحقق الآن
            </button>
            {vResult && (
              <div className={`mt-4 flex items-center justify-center gap-2 rounded-2xl border p-5 text-lg font-extrabold ${
                vResult.valid ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-red-500/50 bg-red-500/10 text-red-300'
              }`}>
                {vResult.valid ? <ShieldCheck size={24} /> : <ShieldAlert size={24} />}
                {vResult.valid ? 'المفتاح سليم — VALID ✅' : 'المفتاح غير صالح — INVALID ❌'}
              </div>
            )}
          </section>
        )}

        {/* ── Shops (client directory, derived) ──── */}
        {tab === 'shops' && (
          <section className={`${card} p-5`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-base font-extrabold">
                <Users size={17} className={GOLD} /> دليل المحلات
              </h2>
              <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] font-bold text-slate-400">
                {filteredShops.length} محل
              </span>
              <span className="flex-1" />
              <div className="relative">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  className="rounded-xl border border-[#233145] bg-[#0b0f17] py-2 pe-4 ps-9 text-[13px] outline-none transition placeholder:text-slate-600 focus:border-[#d4af37]/70"
                  placeholder="بحث: محل، هاتف، ولاية، بصمة…"
                  value={shopSearch}
                  onChange={e => setShopSearch(e.target.value)}
                />
              </div>
            </div>
            {filteredShops.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#233145] py-12 text-center text-slate-500">
                <Users size={32} className="opacity-30" />
                <p className="text-sm font-bold">{shopSearch ? 'لا محلات مطابقة' : 'لا محلات بعد — يُبنى الدليل تلقائياً من الإصدارات'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredShops.map(s => {
                  const open = openShop === s.store;
                  return (
                    <div key={s.store} className="overflow-hidden rounded-xl border border-[#233145] bg-[#0b0f17]">
                      <button
                        type="button"
                        onClick={() => setOpenShop(open ? null : s.store)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-right transition hover:bg-white/[0.02]"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#d4af37]/10 font-extrabold text-[#e8c85a]">
                          {s.store.slice(0, 1)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-extrabold">{s.store}</div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                            <span>{s.issues.length} إصدار · {s.activeHwids.length} بصمة نشطة</span>
                            {s.wilayas[0] && <span className="inline-flex items-center gap-1"><MapPin size={11} />{s.wilayas[0]}</span>}
                            {s.phones[0] && <span dir="ltr">{s.phones[0]}</span>}
                            {s.paidTotal > 0 && <span className="text-emerald-400">{s.paidTotal.toLocaleString('fr-FR')} دج</span>}
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] text-slate-600" dir="ltr">
                          {new Date(s.lastTs).toLocaleDateString('fr-FR')}
                        </span>
                        <ChevronDown size={16} className={`shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`} />
                      </button>
                      {open && (
                        <div className="border-t border-[#1e293b] p-3">
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {s.issues.map(e => (
                              <div key={e.seq} className="flex items-center gap-2 rounded-lg border border-[#1e293b] px-2.5 py-1.5 text-xs">
                                <span className="font-mono font-bold text-[#e8c85a]" dir="ltr">#{e.seq}</span>
                                <span className="font-mono text-[11px] text-slate-400" dir="ltr">{e.hwid}</span>
                                <span className="flex-1" />
                                <MaskedKey value={e.key} id={`shop-${e.seq}`} />
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {s.activeHwids.slice(0, 1).map(h => (
                              <button
                                key={h}
                                type="button"
                                onClick={() => {
                                  const latest = s.issues.filter(e => e.hwid === h).sort((a, b) => b.seq - a.seq)[0];
                                  if (latest) startReplace(latest.seq, s.store);
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-bold text-sky-300 transition hover:bg-sky-500/20"
                              >
                                <Repeat size={13} /> استبدال (بصمة جديدة)
                              </button>
                            ))}
                            <span className="ms-auto self-center text-[11px] text-slate-600">
                              أول إصدار {new Date(s.firstTs).toLocaleDateString('fr-FR')} · آخر {new Date(s.lastTs).toLocaleDateString('fr-FR')}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Audit trail ──────────────────────────── */}
        {tab === 'audit' && (
          <section className={`${card} p-5`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-base font-extrabold">
                <History size={17} className={GOLD} /> سجل التدقيق
              </h2>
              <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] font-bold text-slate-400">
                {auditCount} حدثاً
              </span>
              <span className="flex-1" />
              <button type="button" onClick={() => void refreshAudit()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#233145] bg-[#0b0f17] px-3 py-2 text-xs font-bold text-slate-300 transition hover:border-[#d4af37]/60 hover:text-[#d4af37]">
                <RefreshCw size={14} /> تحديث
              </button>
            </div>
            <p className="mb-3 text-[11px] text-slate-500">كل توليد وتحقق وإلغاء — ناجحاً أو مرفوضاً — يُسجَّل هنا مع الطابع الزمني (ملف <span className="font-mono" dir="ltr">desk-audit.log</span>).</p>
            {auditRows.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">لا أحداث بعد.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#233145]">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr className="bg-[#0b0f17] text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2.5 text-right font-bold">الوقت</th>
                      <th className="px-3 py-2.5 text-right font-bold">العملية</th>
                      <th className="px-3 py-2.5 text-right font-bold">المحل</th>
                      <th className="px-3 py-2.5 text-right font-bold">#</th>
                      <th className="px-3 py-2.5 text-right font-bold">النتيجة</th>
                      <th className="px-3 py-2.5 text-right font-bold">تفصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((a, i) => (
                      <tr key={`${a.ts}-${i}`} className="border-t border-[#1e293b]">
                        <td className="whitespace-nowrap px-3 py-2 text-slate-400" dir="ltr">
                          {new Date(a.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-3 py-2.5 font-bold">
                          {a.action === 'generate' ? 'توليد' : a.action === 'verify' ? 'تحقق' : 'إلغاء'}
                        </td>
                        <td className="max-w-40 truncate px-3 py-2.5" title={a.store ?? ''}>{a.store ?? '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-[#e8c85a]" dir="ltr">{a.seq ? `#${a.seq}` : '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${a.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                            {a.ok ? 'ناجح' : 'مرفوض'}
                          </span>
                        </td>
                        <td className="max-w-56 truncate px-3 py-2.5 text-[12px] text-slate-500" title={a.detail ?? ''}>{a.detail ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ── Ledger ─────────────────────────────── */}
        {tab === 'ledger' && (
          <section className={`${card} p-5`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-base font-extrabold">
                <ScrollText size={17} className={GOLD} /> سجل الإصدارات
              </h2>
              <ChainPill brokenAt={brokenAt} />
              <span className="flex-1" />
              <div className="relative">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  className="rounded-xl border border-[#233145] bg-[#0b0f17] py-2 pe-4 ps-9 text-[13px] outline-none transition placeholder:text-slate-600 focus:border-[#d4af37]/70"
                  placeholder="بحث: محل، بصمة، رقم…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <button type="button" onClick={doCsv} title="تصدير CSV للمحاسبة"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#233145] bg-[#0b0f17] px-3 py-2 text-xs font-bold text-slate-300 transition hover:border-[#d4af37]/60 hover:text-[#d4af37]">
                <Download size={14} /> CSV
              </button>
              <button type="button" onClick={doJson} title="تنزيل نسخة JSON احتياطية"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#233145] bg-[#0b0f17] px-3 py-2 text-xs font-bold text-slate-300 transition hover:border-[#d4af37]/60 hover:text-[#d4af37]">
                <Download size={14} /> JSON
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} title="فحص ملف سجل/نسخة دون المساس بالسلسلة الحية"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#233145] bg-[#0b0f17] px-3 py-2 text-xs font-bold text-slate-300 transition hover:border-[#d4af37]/60 hover:text-[#d4af37]">
                <FileUp size={14} /> فحص ملف
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".jsonl,.json,.log,.txt"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void doCheckFile(f);
                }}
              />
              <button type="button" onClick={() => { setLedgerBusy(true); void refreshAll().finally(() => setLedgerBusy(false)); }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#233145] bg-[#0b0f17] px-3 py-2 text-xs font-bold text-slate-300 transition hover:border-[#d4af37]/60 hover:text-[#d4af37]">
                <RefreshCw size={14} className={ledgerBusy ? 'animate-spin' : ''} /> تحديث
              </button>
            </div>

            {checkErr && (
              <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-[13px] font-bold text-red-200">{checkErr}</div>
            )}
            {checkResult && (
              <div className={`mb-3 flex items-center gap-2 rounded-xl border p-3 text-[13px] font-bold ${checkResult.brokenAt === null ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`}>
                <FileCheck size={16} />
                {checkResult.brokenAt === null
                  ? `الملف المرفوع سليم — ${checkResult.count} سطراً، السلسلة متصلة.`
                  : `الملف المرفوع مكسور عند #${checkResult.brokenAt} من أصل ${checkResult.count} سطراً.`}
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#233145] py-12 text-center text-slate-500">
                <ScrollText size={32} className="opacity-30" />
                <p className="text-sm font-bold">{search ? 'لا نتائج مطابقة للبحث' : 'السجل فارغ — لم يُصدر أي مفتاح بعد'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#233145]">
                <table className="w-full min-w-[880px] text-[13px]">
                  <thead>
                    <tr className="bg-[#0b0f17] text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2.5 text-right font-bold">#</th>
                      <th className="px-3 py-2.5 text-right font-bold">التاريخ</th>
                      <th className="px-3 py-2.5 text-right font-bold">النوع</th>
                      <th className="px-3 py-2.5 text-right font-bold">المحل</th>
                      <th className="px-3 py-2.5 text-right font-bold">HWID</th>
                      <th className="px-3 py-2.5 text-right font-bold">المفتاح</th>
                      <th className="px-3 py-2.5 text-right font-bold">البصمة</th>
                      <th className="px-3 py-2.5 text-right font-bold">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(e => (
                      <tr key={e.seq} className="border-t border-[#1e293b] transition hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5 font-mono font-bold text-[#e8c85a]" dir="ltr">#{e.seq}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-400" dir="ltr">
                          {new Date(e.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                            e.kind === 'issue' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                          }`}>
                            {e.kind === 'issue' ? 'إصدار' : 'إلغاء'}
                          </span>
                        </td>
                        <td className="max-w-40 truncate px-3 py-2.5 font-bold" title={`${e.store}${e.meta?.phone ? ` — ${e.meta.phone}` : ''}${e.meta?.wilaya ? ` — ${e.meta.wilaya}` : ''}`}>{e.store}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-slate-400" dir="ltr">{e.hwid}</td>
                        <td className="whitespace-nowrap px-3 py-2.5"><MaskedKey value={e.key} id={`ledger-${e.seq}`} /></td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-slate-600" dir="ltr" title={e.hash}>
                          {e.hash.slice(0, 12)}…
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {e.kind === 'issue' ? (
                            <span className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => startReplace(e.seq, e.store)}
                                title="استبدال: إصدار بصمة جديدة ثم إلغاء هذا"
                                className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1 text-[11px] font-bold text-sky-300 transition hover:bg-sky-500/15"
                              >
                                <Repeat size={12} />
                                استبدال
                              </button>
                              <button
                                type="button"
                                onClick={() => setRevokeTarget({ seq: e.seq, store: e.store, hwid: e.hwid })}
                                title="إلغاء (مرجع للطاقم فقط)"
                                className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/5 px-2 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-500/15"
                              >
                                <Ban size={12} />
                                إلغاء
                              </button>
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              كل سطر مربوط بسابقه (sha256) + نسخة احتياطية تلقائية مع كل إلحاق — أي تعديل يدوي يُكتشف فوراً.
              الإلغاء مرجع للطاقم فقط: مفاتيح العملاء تتحقق دون اتصال، فالمفتاح الملغي يُعامل كمسروق
              ويُستبدل عبر زر «استبدال» (إصدار جديد + إلغاء القديم في خطوة موجهة).
            </p>
          </section>
        )}

        {/* ── Sign confirmation (ceremony parity with the CLI's yes/NO) */}
        {confirmSign && (
          <Modal
            title="مراجعة أخيرة قبل التوقيع"
            onClose={() => { if (!gBusy) setConfirmSign(false); }}
            actions={
              <>
                <button type="button" onClick={() => void runGenerate(forceDup && dupLocal !== null)} disabled={gBusy} className={btnGold}>
                  {gBusy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                  {gBusy ? 'جارٍ التوقيع…' : 'وقّع وأصدر'}
                </button>
                <button type="button" onClick={() => setConfirmSign(false)} disabled={gBusy} className={btnGhost}>
                  رجوع
                </button>
              </>
            }
          >
            <div className="space-y-2">
              <div className="rounded-xl border border-[#233145] bg-[#0b0f17] p-3">
                <div className="text-[11px] font-bold text-slate-500">المحل</div>
                <div className="font-extrabold">{canonicalStoreName(gStore)}</div>
              </div>
              <div className="rounded-xl border border-[#233145] bg-[#0b0f17] p-3">
                <div className="text-[11px] font-bold text-slate-500">HWID</div>
                <div dir="ltr" className={`${monoLtr} text-sm font-bold`}>{gHwidState.canon}</div>
              </div>
              {(gPhone.trim() || gWilaya.trim() || gPaid.trim()) && (
                <div className="rounded-xl border border-[#233145] bg-[#0b0f17] p-3 text-[13px]">
                  {[gPhone.trim() && `📞 ${gPhone.trim()}`, gWilaya.trim() && `📍 ${gWilaya.trim()}`, gPaid.trim() && `💰 ${gPaid.trim()} دج`]
                    .filter(Boolean).join(' · ')}
                </div>
              )}
              {dupLocal && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] font-bold text-amber-200">
                  تجاوز مكرر: الإصدار #{dupLocal.seq} النشط سيبقى في السجل وسيُسجَّل هذا التجاوز في التدقيق.
                </div>
              )}
              {replaceCtx && (
                <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-[13px] font-bold text-sky-200">
                  استبدال: بعد الإصدار سيُطلب إلغاء #{replaceCtx.oldSeq} مباشرة.
                </div>
              )}
              <p className="text-[12px] text-slate-500">التوقيع نهائي — يُسجَّل في الدفتر المتسلسل مع نسخة احتياطية تلقائية.</p>
              {gErr && <p className="font-bold text-red-300">{gErr}</p>}
            </div>
          </Modal>
        )}

        {/* ── Revoke confirmation */}
        {revokeTarget && (
          <Modal
            title={`إلغاء الإصدار #${revokeTarget.seq}؟`}
            onClose={() => { if (!revoking) setRevokeTarget(null); }}
            actions={
              <>
                <button type="button" onClick={() => void doRevoke()} disabled={revoking} className={btnDanger}>
                  {revoking ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
                  {revoking ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
                </button>
                <button type="button" onClick={() => setRevokeTarget(null)} disabled={revoking} className={btnGhost}>
                  رجوع
                </button>
              </>
            }
          >
            <p>
              المحل <strong>{revokeTarget.store}</strong>
              {revokeTarget.hwid && <> — <span dir="ltr" className="font-mono text-[13px]">{revokeTarget.hwid}</span></>}
            </p>
            <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[13px] text-amber-200">
              مرجع للطاقم فقط — مفاتيح العملاء تتحقق دون اتصال، فالمفتاح الملغي يُعامل كمسروق.
              للإحلال الكامل استخدم «استبدال» من السجل أو دليل المحلات.
            </p>
          </Modal>
        )}

        {/* ── Footer ─────────────────────────────── */}
        <footer className="mt-6 flex flex-wrap items-center justify-center gap-2 text-center text-[11px] text-slate-600">
          <Lock size={12} />
          <span>القاعدة الذهبية: <strong className="text-slate-400">المفتاح الخاص لا يغادر جهاز المالك أبداً.</strong></span>
          <span className="text-slate-700">·</span>
          <span>Baraka Activation Desk v{health?.version ?? '…'} — STAFF ONLY</span>
        </footer>
      </div>
    </div>
  );
}
