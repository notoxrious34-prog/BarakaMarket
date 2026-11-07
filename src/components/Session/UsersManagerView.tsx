import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import {
  listSessionUsers,
  createSessionUser,
  setSessionUserActive,
  resetSessionUserPin,
  getRotationDays,
  setRotationDays,
  lastUserLaneError,
} from '../../core/session-authority';
import { isValidPinFormat } from '../../core/security';
import type { Role } from '../../core/rbac';
import { FREEZE_REASONS } from '../../types/index';
import type { FreezeReasonCode } from '../../types/index';

/**
 * T8 (ADR-031) + T8b — owner-only user management.
 * Self-gating is convenience, not security: the native and server lanes
 * re-check `requesterRole`, owner accounts are immune, and every change lands
 * in the audit trail. New accounts start with `must_change_pin = 1`, so a
 * provisioned PIN never survives first login.
 */
const USERNAME_RE = /^[a-z0-9._-]{3,20}$/i;
const EMPTY_FORM = { username: '', displayName: '', role: 'cashier' as Role, pin: '', confirmPin: '' };

type Msg = { kind: 'ok' | 'err'; text: string } | null;
type Lane = 'loading' | 'ready' | 'offline';

const ROLE_LABEL: Record<'ar' | 'fr', Record<Role, string>> = {
  ar: { owner: 'مالك', manager: 'مدير', cashier: 'كاشير' },
  fr: { owner: 'Gérant', manager: 'Manager', cashier: 'Caissier' },
};

/** v1.5.1 §1: freeze-reason labels (reason + note are both mandatory). */
const FREEZE_LABEL: Record<'ar' | 'fr', Record<FreezeReasonCode, string>> = {
  ar: { RESIGNED: 'استقالة', LEAVE: 'إجازة', MISUSE: 'سوء استخدام', OTHER: 'أخرى' },
  fr: { RESIGNED: 'Démission', LEAVE: 'Congé', MISUSE: 'Abus', OTHER: 'Autre' },
};

export const UsersManagerView: React.FC = () => {
  const { language, session, sessionUsers, refreshSessionUsers } = useApp();
  const ar = language === 'ar';
  const loc = ar ? 'ar' : 'fr';
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPin, setShowPin] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [lane, setLane] = useState<Lane>('loading');
  // v1.5.1 §1: inline freeze panel — reason + note are both mandatory.
  const [freezeId, setFreezeId] = useState<number | null>(null);
  const [freezeReason, setFreezeReason] = useState<FreezeReasonCode>('RESIGNED');
  const [freezeNote, setFreezeNote] = useState('');
  // v1.5.1 §3: inline temporary-PIN panel — issued PIN dies at first login.
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPin, setResetPin] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  // §3 completion: temp-PIN lifespan (PLAN binds expiry — auto-dies).
  const [resetHours, setResetHours] = useState<'8' | '24' | '48'>('24');
  // v1.5.1 B2-5: second owner needs the requesting owner's own current PIN
  // (presence proof) — replaces the single window.confirm, doubly audited.
  const [ownerPin, setOwnerPin] = useState('');
  // v1.5.1 §4: rotation window (days) — owner config, re-armed per login.
  const [rotDays, setRotDays] = useState<number>(90);
  const [rotInput, setRotInput] = useState('90');
  const [rotBusy, setRotBusy] = useState(false);

  // The shop survives reloads with a persisted session while this tab mounts
  // on demand — fetch on every visit so the list is never a stale empty.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLane('loading');
      await refreshSessionUsers();
      if (!alive) return;
      const list = await listSessionUsers();
      if (!alive) return;
      setLane(list ? 'ready' : 'offline');
      // v1.5.1 §4: rotation window for the countdown chips.
      try {
        const d = await getRotationDays();
        if (!alive) return;
        setRotDays(d);
        setRotInput(String(d));
      } catch { /* default 90 stands */ }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allowed = !!session && can(session.role, 'users.manage');
  if (!allowed) {
    return (
      <div className="rounded-2xl border border-slate-700/60 bg-[#0e141f] p-4" role="note">
        <p className="text-xs text-amber-200">{ar ? 'مقتصر على المالك.' : 'Réservé au gérant.'}</p>
      </div>
    );
  }

  const mapLaneError = (raw: string | null): string => {
    const e = (raw ?? '').toLowerCase();
    if (e.includes('owner role required') || e.includes('403') || e.includes('token required')) {
      return ar ? 'مرفوض: مقتصر على المالك.' : 'Refusé : réservé au gérant.';
    }
    if (e.includes('cannot be deactivated')) {
      return ar ? 'حساب المالك لا يُعطَّل أبداً.' : 'Le compte gérant ne se désactive jamais.';
    }
    if (e.includes('never reset')) {
      return ar ? 'حساب المالك لا يُصفَّر أبداً — غيّر رمزك بالرمز الحالي.' : 'Le code gérant ne se réinitialise jamais — changez-le avec l’ancien code.';
    }
    if (e.includes('second-owner')) return ar ? 'مالك ثانٍ: رمز التأكيد مرفوض — أدخل رمزك أنت.' : 'Second gérant : code de confirmation refusé — tapez VOTRE code.';
    if (e.includes('taken')) return ar ? 'الاسم محجوز — اختر اسماً آخر.' : 'Nom déjà pris — choisissez un autre nom.';
    if (e.includes('bad username') || e.includes('username')) {
      return ar ? 'اسم المستخدم: 3-20 (حروف لاتينية/أرقام/._-)' : 'Nom d’utilisateur : 3-20 (a-z 0-9 . _ -)';
    }
    if (e.includes('bad role')) return ar ? 'دور غير معروف.' : 'Rôle inconnu.';
    if (e.includes('pin')) return ar ? 'الرمز: 4-8 أرقام.' : 'Code : 4-8 chiffres.';
    if (e.includes('unknown user')) return ar ? 'مستخدم غير معروف.' : 'Utilisateur inconnu.';
    if (e.includes('freeze reason')) return ar ? 'سبب التجميد إجباري — اختر سبباً واكتب ملاحظة.' : 'Motif de gel requis — choisissez un motif et une note.';
    if (
      !e ||
      e.includes('unreachable') ||
      e.includes('failed to fetch') ||
      e.includes('abort') ||
      e.includes('network') ||
      e.includes('native lane refused') ||
      e.includes('server refused')
    ) {
      return ar
        ? 'القاعدة غير متصلة — تحقق من المسار الأصلي أو الخادم المحلي.'
        : 'Base injoignable — vérifiez la voie native ou le serveur local.';
    }
    return ar ? `تعذّر التنفيذ (${raw}).` : `Échec (${raw}).`;
  };

  const create = async () => {
    if (creating || !session) return;
    const username = form.username.trim();
    if (!USERNAME_RE.test(username)) {
      setMsg({ kind: 'err', text: ar ? 'اسم المستخدم: 3-20 (حروف لاتينية/أرقام/._-)' : 'Nom d’utilisateur : 3-20 (a-z 0-9 . _ -)' });
      return;
    }
    if (!isValidPinFormat(form.pin)) {
      setMsg({ kind: 'err', text: ar ? 'الرمز: 4-8 أرقام' : 'Code : 4-8 chiffres' });
      return;
    }
    if (form.pin !== form.confirmPin) {
      setMsg({ kind: 'err', text: ar ? 'التأكيد لا يطابق الرمز — أعد الإدخال' : 'La confirmation ne correspond pas — recommencez' });
      return;
    }
    // v1.5.1 B2-5: second owner needs the REQUESTING owner's own current
    // PIN typed in (presence proof, doubly audited) — no more blind confirm.
    if (form.role === 'owner' && !isValidPinFormat(ownerPin)) {
      setMsg({ kind: 'err', text: ar ? 'مالك ثانٍ: أدخل رمزك أنت للتأكيد (4-8 أرقام)' : 'Second gérant : tapez VOTRE code pour confirmer (4-8 chiffres)' });
      return;
    }
    setCreating(true);
    setMsg(null);
    try {
      const u = await createSessionUser(
        {
          username,
          display_name: form.displayName.trim().slice(0, 40) || username,
          role: form.role,
          pin: form.pin,
        },
        session.role,
        session.username,
        form.role === 'owner' ? { ownerConfirmPin: ownerPin } : undefined,
      );
      if (!u) {
        setMsg({ kind: 'err', text: mapLaneError(lastUserLaneError()) });
        return;
      }
      setForm(EMPTY_FORM);
      setOwnerPin('');
      await refreshSessionUsers();
      setMsg({ kind: 'ok', text: ar ? `تم إنشاء ${u.username} — سيُطلب منه تغيير الرمز عند أول دخول` : `${u.username} créé — changement de code requis à la première connexion` });
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (id: number, currentlyActive: boolean, username: string) => {
    if (pendingId !== null || !session) return;
    if (currentlyActive) {
      // v1.5.1 §1: no blind confirm — open the freeze panel (reason + note).
      setFreezeId(freezeId === id ? null : id);
      setFreezeReason('RESIGNED');
      setFreezeNote('');
      setMsg(null);
      return;
    }
    const ok = window.confirm(
      ar
        ? `إعادة تفعيل ${username}؟ سيستعيد الدخول فوراً. يُسجَّل في التدقيق.`
        : `Réactiver ${username} ? Accès immédiat. Tracé en audit.`,
    );
    if (!ok) return;
    setPendingId(id);
    setMsg(null);
    try {
      const done = await setSessionUserActive(id, true, session.role, session.username);
      if (!done) {
        setMsg({ kind: 'err', text: mapLaneError(lastUserLaneError()) });
        return;
      }
      await refreshSessionUsers();
      setMsg({ kind: 'ok', text: ar ? `تمت إعادة تفعيل ${username}` : `${username} réactivé` });
    } finally {
      setPendingId(null);
    }
  };

  const confirmFreeze = async (id: number, username: string) => {
    if (pendingId !== null || !session) return;
    const note = freezeNote.trim();
    if (note === '') {
      setMsg({ kind: 'err', text: ar ? 'الملاحظة إجبارية — سطر واحد يوثّق سبب التجميد.' : 'Note requise — une ligne qui documente le gel.' });
      return;
    }
    setPendingId(id);
    setMsg(null);
    try {
      const done = await setSessionUserActive(id, false, session.role, session.username, {
        reason: freezeReason, note,
      });
      if (!done) {
        setMsg({ kind: 'err', text: mapLaneError(lastUserLaneError()) });
        return;
      }
      setFreezeId(null);
      setFreezeNote('');
      await refreshSessionUsers();
      setMsg({
        kind: 'ok',
        text: ar
          ? `تم تجميد ${username} [${FREEZE_LABEL.ar[freezeReason]}]`
          : `${username} gelé [${FREEZE_LABEL.fr[freezeReason]}]`,
      });
    } finally {
      setPendingId(null);
    }
  };

  // v1.5.1 §3: issue a temporary PIN — the lane flags must_change so the
  // PIN dies at first login. PIN shape + match are checked lane-side too.
  // v1.5.1 §4: owner sets the rotation window (1..365, audited, both lanes).
  const saveRotation = async () => {
    if (rotBusy || !session) return;
    const n = Number.parseInt(rotInput, 10);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      setMsg({ kind: 'err', text: ar ? 'النافذة بين يوم و365 يوماً.' : 'Fenêtre : 1 à 365 jours.' });
      return;
    }
    setRotBusy(true);
    setMsg(null);
    try {
      await setRotationDays(n, session.username);
      setRotDays(n);
      setRotInput(String(n));
      setMsg({ kind: 'ok', text: ar ? `حُفظت نافذة التدوير: كل ${n} يوم` : `Fenêtre de rotation : tous les ${n} jours` });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : (ar ? 'تعذر حفظ نافذة التدوير' : 'Échec de sauvegarde') });
    } finally {
      setRotBusy(false);
    }
  };

  const confirmReset = async (id: number, username: string) => {
    if (pendingId !== null || !session) return;
    if (!isValidPinFormat(resetPin)) {
      setMsg({ kind: 'err', text: ar ? 'الرمز: 4-8 أرقام' : 'Code : 4-8 chiffres' });
      return;
    }
    if (resetPin !== resetConfirm) {
      setMsg({ kind: 'err', text: ar ? 'التأكيد لا يطابق الرمز — أعد الإدخال' : 'La confirmation ne correspond pas — recommencez' });
      return;
    }
    setPendingId(id);
    setMsg(null);
    try {
      const expiresAt = new Date(Date.now() + Number(resetHours) * 3600_000).toISOString().slice(0, 19);
      const done = await resetSessionUserPin(id, resetPin, session.role, session.username, { expiresAt });
      if (!done) {
        setMsg({ kind: 'err', text: mapLaneError(lastUserLaneError()) });
        return;
      }
      setResetId(null);
      setResetPin('');
      setResetConfirm('');
      await refreshSessionUsers();
      setMsg({
        kind: 'ok',
        text: ar
          ? `تم إصدار رمز مؤقت لـ ${username} (صالح ${resetHours} سا، يُطلب تغييره عند الدخول)`
          : `Code temporaire émis pour ${username} (valide ${resetHours}h, changement requis à la connexion)`,
      });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-[#0e141f] p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-bold text-amber-300">{ar ? 'المستخدمون والأدوار' : 'Utilisateurs et rôles'}</h2>
        <span className="text-[11px] text-slate-500" dir="ltr">
          {sessionUsers.length}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">
        {ar
          ? 'الإنشاء والتجميد للمالك فقط؛ المالك الثاني بتأكيد رمز مالك موجود وتوثيق مضاعف؛ التجميد بسبب وملاحظة إجباريين، كل حركة مسجلة في التدقيق، والحسابات الجديدة تغيّر رمزها عند أول دخول.'
          : 'Création/gel réservés au gérant ; second gérant avec confirmation du code d’un gérant existant + double audit ; gel à motif + note obligatoires, chaque mouvement est audité, les nouveaux comptes changent leur code à la première connexion.'}
      </p>
      {lane === 'offline' && (
        <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200" role="alert">
          {ar ? 'القاعدة غير متصلة — القائمة قد تكون ناقصة والإنشاء معطّل.' : 'Base injoignable — liste possiblement incomplète, création suspendue.'}
        </p>
      )}

      {/* v1.5.1 §4: rotation window — owner config, audited, both lanes. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-[#0b0f17] px-3 py-2 text-[12px]">
        <span className="text-slate-400">
          {ar ? 'التدوير الإجباري كل' : 'Rotation obligatoire tous les'}
        </span>
        <input
          inputMode="numeric"
          dir="ltr"
          value={rotInput}
          onChange={e => setRotInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          className="w-16 rounded-md border border-slate-700 bg-[#0e141f] px-2 py-1 text-center text-slate-100 tabular-nums"
          aria-label={ar ? 'نافذة التدوير بالأيام' : 'Fenêtre de rotation (jours)'}
        />
        <span className="text-slate-400">{ar ? `يوم (الحالية: ${rotDays})` : `jours (actuelle : ${rotDays})`}</span>
        <button
          onClick={() => void saveRotation()}
          disabled={rotBusy}
          className="rounded-md bg-amber-600/80 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-600 disabled:opacity-50 cursor-pointer"
        >
          {rotBusy ? (ar ? 'جارٍ الحفظ…' : 'Enregistrement…') : (ar ? 'حفظ النافذة' : 'Enregistrer')}
        </button>
      </div>

      <div className="space-y-2 mb-4">
        {lane === 'loading' && sessionUsers.length === 0 && (
          <p className="text-sm text-slate-500">{ar ? 'جارٍ التحميل…' : 'Chargement…'}</p>
        )}
        {lane !== 'loading' && sessionUsers.length === 0 && (
          <p className="text-sm text-slate-500">{ar ? 'لا مستخدمون ظاهرون — تحقق من الاتصال.' : 'Aucun utilisateur visible — vérifiez la connexion.'}</p>
        )}
        {sessionUsers.map(u => {
          const isSelf = !!session && u.username === session.username;
          const frozen = u.role === 'owner' || isSelf;
          const busy = pendingId === u.id;
          const frozenTitle = u.role === 'owner'
            ? (ar ? 'حساب المالك لا يُعطَّل أبداً (حماية على مستوى القاعدة)' : 'Le compte gérant ne se désactive jamais (garde base)')
            : (ar ? 'لا تغيّر حالتك بنفسك من هنا' : 'Ne changez pas votre propre statut ici');
          return (
            <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#0b0f17] border border-slate-800 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{u.display_name}</span>
                <span className="text-slate-500"> @{u.username}</span>
                <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${u.role === 'owner' ? 'bg-amber-500/20 text-amber-300' : u.role === 'manager' ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-500/20 text-slate-300'}`}>
                  {ROLE_LABEL[loc][u.role] ?? u.role}
                </span>
                {u.must_change_pin === 1 && (
                  <span className="ml-1 text-[10px] text-orange-400" title={ar ? 'سيُطلب منه تغيير الرمز عند أول دخول' : 'Changement de code requis à la première connexion'}>
                    {ar ? 'تغيير الرمز مطلوب' : 'Changement requis'}
                    {u.pin_expires_at ? ` ${ar ? 'حتى' : "jusqu'au"} ${u.pin_expires_at.slice(0, 16).replace('T', ' ')}` : ''}
                  </span>
                )}
                {u.active === 0 && (
                  <span className="ml-1 text-[10px] text-red-400" title={u.freeze_note ?? undefined}>
                    {ar ? 'معطَّل' : 'Désactivé'}
                    {u.freeze_reason ? ` [${FREEZE_LABEL[loc][u.freeze_reason as FreezeReasonCode] ?? u.freeze_reason}]` : ''}
                  </span>
                )}
                {/* v1.5.1 §4: rotation countdown from the pin_changed_at clock. */}
                {u.active === 1 && u.pin_changed_at && (() => {
                  const t = Date.parse(`${u.pin_changed_at}Z`);
                  if (!Number.isFinite(t)) return null;
                  const left = rotDays - Math.floor((Date.now() - t) / 86_400_000);
                  if (left <= 0) {
                    return (
                      <span className="ml-1 text-[10px] font-bold text-red-400">
                        {ar ? 'التدوير متجاوز — سيُجبر عند الدخول' : 'Rotation dépassée — forcée à la connexion'}
                      </span>
                    );
                  }
                  const tone = left <= 7 ? 'text-amber-300' : 'text-slate-500';
                  return (
                    <span className={`ml-1 text-[10px] ${tone}`}>
                      {ar ? `التدوير بعد ${left} ${left === 1 ? 'يوم' : 'أيام'}` : `Rotation dans ${left} j`}
                    </span>
                  );
                })()}
              </span>
              {frozen ? (
                <span className="text-[11px] px-2 py-1 text-slate-600" title={frozenTitle}>
                  {ar ? 'محمي' : 'Protégé'}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setResetId(resetId === u.id ? null : u.id); setResetPin(''); setResetConfirm(''); }}
                    disabled={busy}
                    title={ar ? 'إصدار رمز مؤقت (تغيير إجباري عند الدخول)' : 'Émettre un code temporaire (changement requis à la connexion)'}
                    className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 hover:border-sky-400/50 text-slate-300 disabled:opacity-50"
                  >
                    {ar ? 'رمز مؤقت' : 'Code temp.'}
                  </button>
                  <button
                    onClick={() => void toggle(u.id, u.active === 1, u.username)}
                    disabled={busy}
                    title={u.active === 1 ? (ar ? 'تجميد الدخول (سبب إجباري)' : 'Geler l’accès (motif requis)') : (ar ? 'إعادة التفعيل' : 'Réactiver')}
                    className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 hover:border-amber-400/50 text-slate-300 disabled:opacity-50"
                  >
                    {busy ? '…' : u.active === 1 ? (ar ? 'تجميد' : 'Geler') : (ar ? 'تفعيل' : 'Activer')}
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* v1.5.1 §1: inline freeze panel — reason + note, both mandatory. */}
      {freezeId !== null && (() => {
        const target = sessionUsers.find(x => x.id === freezeId);
        if (!target || target.active === 0) return null;
        return (
          <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/5 px-3 py-2.5" role="dialog" aria-label={ar ? 'تجميد مستخدم' : 'Gel utilisateur'}>
            <p className="mb-2 text-xs font-bold text-amber-200">
              {ar ? `تجميد ${target.username} — السبب والملاحظة إجباريان ويُسجَّلان في التدقيق` : `Geler ${target.username} — motif et note requis, tracés en audit`}
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={freezeReason}
                onChange={e => setFreezeReason(e.target.value as FreezeReasonCode)}
                className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60"
              >
                {FREEZE_REASONS.map(r => (
                  <option key={r} value={r}>{FREEZE_LABEL[loc][r]}</option>
                ))}
              </select>
              <input
                value={freezeNote}
                onChange={e => setFreezeNote(e.target.value.slice(0, 140))}
                placeholder={ar ? 'ملاحظة التوثيق (إجبارية، ≤140)' : 'Note de traçage (requise, ≤140)'}
                className="flex-1 rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60 placeholder:text-slate-600"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void confirmFreeze(target.id, target.username)}
                  disabled={pendingId !== null}
                  className="rounded-lg bg-red-600/90 hover:bg-red-500 text-white text-xs font-bold px-3 py-1.5 disabled:opacity-50"
                >
                  {ar ? 'تأكيد التجميد' : 'Confirmer le gel'}
                </button>
                <button
                  type="button"
                  onClick={() => { setFreezeId(null); setFreezeNote(''); }}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400"
                >
                  {ar ? 'إلغاء' : 'Annuler'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* v1.5.1 §3: inline temporary-PIN panel — issued PIN dies at login. */}
      {resetId !== null && (() => {
        const target = sessionUsers.find(x => x.id === resetId);
        if (!target || target.role === 'owner') return null;
        return (
          <div className="mb-4 rounded-xl border border-sky-400/40 bg-sky-500/5 px-3 py-2.5" role="dialog" aria-label={ar ? 'رمز مؤقت' : 'Code temporaire'}>
            <p className="mb-2 text-xs font-bold text-sky-200">
              {ar ? `رمز مؤقت لـ ${target.username} — 4-8 أرقام، يُطلب تغييره عند أول دخول` : `Code temporaire pour ${target.username} — 4-8 chiffres, changement requis à la connexion`}
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={resetHours}
                onChange={e => setResetHours(e.target.value as '8' | '24' | '48')}
                title={ar ? 'مدة الصلاحية' : 'Durée de validité'}
                className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-sky-400/60"
              >
                <option value="8">{ar ? 'صالح 8 ساعات' : 'Valide 8h'}</option>
                <option value="24">{ar ? 'صالح 24 ساعة' : 'Valide 24h'}</option>
                <option value="48">{ar ? 'صالح 48 ساعة' : 'Valide 48h'}</option>
              </select>
              <input
                value={resetPin}
                onChange={e => setResetPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder={ar ? 'الرمز المؤقت' : 'Code temporaire'}
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                type={showPin ? 'text' : 'password'}
                className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-sky-400/60 placeholder:text-slate-600"
              />
              <input
                value={resetConfirm}
                onChange={e => setResetConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder={ar ? 'تأكيد الرمز' : 'Confirmer le code'}
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                type={showPin ? 'text' : 'password'}
                className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-sky-400/60 placeholder:text-slate-600"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void confirmReset(target.id, target.username)}
                  disabled={pendingId !== null}
                  className="rounded-lg bg-sky-600/90 hover:bg-sky-500 text-white text-xs font-bold px-3 py-1.5 disabled:opacity-50"
                >
                  {ar ? 'إصدار الرمز' : 'Émettre'}
                </button>
                <button
                  type="button"
                  onClick={() => { setResetId(null); setResetPin(''); setResetConfirm(''); }}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400"
                >
                  {ar ? 'إلغاء' : 'Annuler'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <form
        onSubmit={e => {
          e.preventDefault();
          void create();
        }}
        className="grid grid-cols-2 md:grid-cols-6 gap-2"
      >
        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-400">{ar ? 'اسم المستخدم' : 'Nom d’utilisateur'}</span>
          <input
            value={form.username}
            onChange={e => setForm({ ...form, username: e.target.value })}
            placeholder="sara"
            dir="ltr"
            maxLength={20}
            autoComplete="off"
            className="w-full rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-400">{ar ? 'الاسم المعروض' : 'Nom affiché'}</span>
          <input
            value={form.displayName}
            onChange={e => setForm({ ...form, displayName: e.target.value })}
            placeholder={ar ? 'مثال: سارة' : 'ex. Sara'}
            maxLength={40}
            autoComplete="off"
            className="w-full rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-400">{ar ? 'الدور' : 'Rôle'}</span>
          <select
            value={form.role}
            onChange={e => { const r = e.target.value as Role; setForm({ ...form, role: r }); if (r !== 'owner') setOwnerPin(''); }}
            className="w-full rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60"
          >
            <option value="cashier">{ROLE_LABEL[loc].cashier}</option>
            <option value="manager">{ROLE_LABEL[loc].manager}</option>
            <option value="owner">{ROLE_LABEL[loc].owner}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-400">{ar ? 'الرمز (4-8 أرقام)' : 'Code (4-8 chiffres)'}</span>
          <input
            value={form.pin}
            onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })}
            placeholder="••••"
            dir="ltr"
            inputMode="numeric"
            type={showPin ? 'text' : 'password'}
            autoComplete="new-password"
            className="w-full rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-400">{ar ? 'تأكيد الرمز' : 'Confirmer le code'}</span>
          <input
            value={form.confirmPin}
            onChange={e => setForm({ ...form, confirmPin: e.target.value.replace(/\D/g, '').slice(0, 8) })}
            placeholder="••••"
            dir="ltr"
            inputMode="numeric"
            type={showPin ? 'text' : 'password'}
            autoComplete="new-password"
            className="w-full rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60"
          />
        </label>
        {form.role === 'owner' && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-amber-300">{ar ? 'رمزك أنت للتأكيد (مالك موجود)' : 'VOTRE code (gérant existant)'}</span>
            <input
              value={ownerPin}
              onChange={e => setOwnerPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="••••"
              dir="ltr"
              inputMode="numeric"
              type={showPin ? 'text' : 'password'}
              autoComplete="current-password"
              className="w-full rounded-lg bg-[#0b0f17] border border-amber-500/50 px-2 py-1.5 text-sm outline-none focus:border-amber-400"
            />
          </label>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setShowPin(s => !s)}
            className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-400 hover:border-amber-400/50"
            title={ar ? 'إظهار/إخفاء الرمز' : 'Afficher/masquer le code'}
          >
            {showPin ? (ar ? 'إخفاء' : 'Masquer') : (ar ? 'إظهار' : 'Voir')}
          </button>
          <button
            type="submit"
            disabled={creating || lane === 'offline'}
            title={lane === 'offline' ? (ar ? 'القاعدة غير متصلة' : 'Base injoignable') : undefined}
            className="flex-1 rounded-lg bg-amber-500/90 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50 px-2 py-1.5"
          >
            {creating ? (ar ? 'جارٍ الإنشاء…' : 'Création…') : (ar ? 'إنشاء' : 'Créer')}
          </button>
        </div>
      </form>
      {msg && (
        <p role="status" aria-live="polite" className={`mt-2 text-xs ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
};
