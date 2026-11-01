import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import { createSessionUser, setSessionUserActive } from '../../core/session-authority';
import type { Role } from '../../core/rbac';

/**
 * T8 (ADR-031) — owner-only user management. Self-gating: renders nothing
 * unless the session can('users.manage'). The server re-checks requesterRole,
 * so hiding the UI is convenience, not security.
 */
export const UsersManagerView: React.FC = () => {
  const { language, session, sessionUsers, refreshSessionUsers } = useApp();
  const ar = language === 'ar';
  const [form, setForm] = useState({ username: '', display_name: '', role: 'cashier' as Role, pin: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session || !can(session.role, 'users.manage')) return null;

  const create = async () => {
    setMsg(null);
    if (!/^[a-z0-9._-]{3,20}$/i.test(form.username.trim())) {
      setMsg(ar ? 'اسم المستخدم: 3-20 (حروف لاتينية/أرقام/._-)' : 'Nom d’utilisateur : 3-20 (a-z 0-9 . _ -)');
      return;
    }
    if (!/^\d{4,8}$/.test(form.pin)) {
      setMsg(ar ? 'الرمز: 4-8 أرقام' : 'Code : 4-8 chiffres');
      return;
    }
    setBusy(true);
    try {
      const u = await createSessionUser(
        { username: form.username.trim(), display_name: form.display_name.trim() || form.username.trim(), role: form.role, pin: form.pin },
        session.role, session.username,
      );
      if (!u) {
        setMsg(ar ? 'تعذّر الإنشاء (تحقق من الاتصال أو الاسم)' : 'Création impossible (connexion ou nom déjà pris)');
        return;
      }
      setForm({ username: '', display_name: '', role: 'cashier', pin: '' });
      await refreshSessionUsers();
      setMsg(ar ? `تم إنشاء ${u.username}` : `${u.username} créé`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: number, active: boolean) => {
    setMsg(null);
    const ok = await setSessionUserActive(id, !active, session.role, session.username);
    if (!ok) {
      setMsg(ar ? 'تعذّر التغيير' : 'Modification impossible');
      return;
    }
    await refreshSessionUsers();
  };

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-[#0e141f] p-4">
      <h2 className="font-bold text-amber-300 mb-3">{ar ? 'المستخدمون والأدوار' : 'Utilisateurs et rôles'}</h2>
      <div className="space-y-2 mb-4">
        {sessionUsers.map(u => (
          <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#0b0f17] border border-slate-800 px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{u.display_name}</span>
              <span className="text-slate-500"> @{u.username}</span>
              <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${u.role === 'owner' ? 'bg-amber-500/20 text-amber-300' : u.role === 'manager' ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-500/20 text-slate-300'}`}>
                {u.role}
              </span>
              {u.must_change_pin === 1 && <span className="ml-1 text-[10px] text-orange-400">PIN!</span>}
              {u.active === 0 && <span className="ml-1 text-[10px] text-red-400">✕</span>}
            </span>
            {u.role !== 'owner' && (
              <button
                onClick={() => void toggle(u.id, u.active === 1)}
                className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 hover:border-amber-400/50 text-slate-300"
              >
                {u.active === 1 ? (ar ? 'تعطيل' : 'Désactiver') : (ar ? 'تفعيل' : 'Activer')}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder={ar ? 'اسم المستخدم' : 'Nom d’utilisateur'} dir="ltr"
          className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60" />
        <input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })}
          placeholder={ar ? 'الاسم المعروض' : 'Nom affiché'}
          className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60" />
        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}
          className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60">
          <option value="cashier">cashier</option>
          <option value="manager">manager</option>
          <option value="owner">owner</option>
        </select>
        <input value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })} placeholder="PIN" dir="ltr" inputMode="numeric"
          className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60" />
        <button onClick={() => void create()} disabled={busy}
          className="rounded-lg bg-amber-500/90 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50">
          {ar ? 'إنشاء' : 'Créer'}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-slate-300">{msg}</p>}
    </div>
  );
};
