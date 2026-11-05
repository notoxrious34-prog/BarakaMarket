import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import {
  createSessionUser,
  lastUserLaneError,
  listSessionUsers,
  setSessionUserActive,
} from '../../core/session-authority';
import { isValidPinFormat } from '../../core/security';
import type { Role } from '../../core/rbac';

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
    if (e.includes('taken')) return ar ? 'الاسم محجوز — اختر اسماً آخر.' : 'Nom déjà pris — choisissez un autre nom.';
    if (e.includes('bad username') || e.includes('username')) {
      return ar ? 'اسم المستخدم: 3-20 (حروف لاتينية/أرقام/._-)' : 'Nom d’utilisateur : 3-20 (a-z 0-9 . _ -)';
    }
    if (e.includes('bad role')) return ar ? 'دور غير معروف.' : 'Rôle inconnu.';
    if (e.includes('pin')) return ar ? 'الرمز: 4-8 أرقام.' : 'Code : 4-8 chiffres.';
    if (e.includes('unknown user')) return ar ? 'مستخدم غير معروف.' : 'Utilisateur inconnu.';
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
    if (form.role === 'owner') {
      const ok = window.confirm(
        ar
          ? `إنشاء مالك ثانٍ (${username}) بصلاحيات كاملة؟ يُسجَّل في التدقيق.`
          : `Créer un second gérant (${username}) avec tous les droits ? Tracé en audit.`,
      );
      if (!ok) return;
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
      );
      if (!u) {
        setMsg({ kind: 'err', text: mapLaneError(lastUserLaneError()) });
        return;
      }
      setForm(EMPTY_FORM);
      await refreshSessionUsers();
      setMsg({ kind: 'ok', text: ar ? `تم إنشاء ${u.username} — سيُطلب منه تغيير الرمز عند أول دخول` : `${u.username} créé — changement de code requis à la première connexion` });
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (id: number, currentlyActive: boolean, username: string) => {
    if (pendingId !== null || !session) return;
    if (currentlyActive) {
      const ok = window.confirm(
        ar
          ? `تعطيل ${username}؟ لن يتمكن من الدخول حتى إعادة التفعيل. يُسجَّل في التدقيق.`
          : `Désactiver ${username} ? Plus d’accès jusqu’à réactivation. Tracé en audit.`,
      );
      if (!ok) return;
    }
    setPendingId(id);
    setMsg(null);
    try {
      const done = await setSessionUserActive(id, !currentlyActive, session.role, session.username);
      if (!done) {
        setMsg({ kind: 'err', text: mapLaneError(lastUserLaneError()) });
        return;
      }
      await refreshSessionUsers();
      setMsg({
        kind: 'ok',
        text: ar
          ? currentlyActive
            ? `تم تعطيل ${username}`
            : `تمت إعادة تفعيل ${username}`
          : currentlyActive
            ? `${username} désactivé`
            : `${username} réactivé`,
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
          ? 'الإنشاء والتفعيل للمالك فقط، كل حركة مسجلة في التدقيق، والحسابات الجديدة تغيّر رمزها عند أول دخول.'
          : 'Création/activation réservées au gérant, chaque mouvement est audité, les nouveaux comptes changent leur code à la première connexion.'}
      </p>
      {lane === 'offline' && (
        <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200" role="alert">
          {ar ? 'القاعدة غير متصلة — القائمة قد تكون ناقصة والإنشاء معطّل.' : 'Base injoignable — liste possiblement incomplète, création suspendue.'}
        </p>
      )}

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
                  </span>
                )}
                {u.active === 0 && <span className="ml-1 text-[10px] text-red-400">{ar ? 'معطَّل' : 'Désactivé'}</span>}
              </span>
              {frozen ? (
                <span className="text-[11px] px-2 py-1 text-slate-600" title={frozenTitle}>
                  {ar ? 'محمي' : 'Protégé'}
                </span>
              ) : (
                <button
                  onClick={() => void toggle(u.id, u.active === 1, u.username)}
                  disabled={busy}
                  title={u.active === 1 ? (ar ? 'تعطيل الدخول' : 'Désactiver l’accès') : (ar ? 'إعادة التفعيل' : 'Réactiver')}
                  className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 hover:border-amber-400/50 text-slate-300 disabled:opacity-50"
                >
                  {busy ? '…' : u.active === 1 ? (ar ? 'تعطيل' : 'Désactiver') : (ar ? 'تفعيل' : 'Activer')}
                </button>
              )}
            </div>
          );
        })}
      </div>

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
            onChange={e => setForm({ ...form, role: e.target.value as Role })}
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
