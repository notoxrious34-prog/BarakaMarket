import React, { useEffect, useState } from 'react';
import { Key, KeyPad } from '../ui/KeyPad';
import { useApp } from '../../context/AppContext';
import { changeSessionPin } from '../../core/session-authority';

/**
 * T8 (ADR-031) — the single gate of the shop. Full-screen takeover: no
 * session (or a locked session) means no POS, no stock, no accounting.
 * PINs are verified by the DAL (native invoke-first, loopback fallback);
 * this screen never sees a verifier, only ok/locked verdicts.
 */
export const LoginScreen: React.FC = () => {
  const {
    language, toggleLanguage, session, sessionLocked, lockNotice,
    sessionUsers, refreshSessionUsers, login, logout, unlockSession, setActiveView,
  } = useApp();
  const ar = language === 'ar';
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState<{ userId: number; username: string } | null>(null);
  const [oldPin, setOldPin] = useState('');
  const [phase, setPhase] = useState<'new' | 'confirm'>('new');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  useEffect(() => {
    void refreshSessionUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!username && sessionUsers.length > 0) {
      const owner = sessionUsers.find(u => u.username === 'owner') ?? sessionUsers[0];
      setUsername(owner.username);
    }
  }, [sessionUsers, username]);

  const press = (d: string) => {
    setError(null);
    if (mustChange) {
      if (phase === 'new') setNewPin(p => (p + d).slice(0, 8));
      else setConfirmPin(p => (p + d).slice(0, 8));
      return;
    }
    setPin(p => (p + d).slice(0, 8));
  };
  const clear = () => {
    setError(null);
    if (mustChange) {
      if (phase === 'confirm') setConfirmPin('');
      else setNewPin('');
      return;
    }
    setPin('');
  };
  // T11: physical-keyboard parity — Backspace erases one digit (the pad's C
  // wipes all). Zero-Mouse holds on the lock screen too.
  const back = () => {
    setError(null);
    if (mustChange) {
      if (phase === 'confirm') setConfirmPin(p => p.slice(0, -1));
      else setNewPin(p => p.slice(0, -1));
      return;
    }
    setPin(p => p.slice(0, -1));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === 'Enter') { e.preventDefault(); advanceOrSubmit(); }
      else if (e.key === 'Escape') { e.preventDefault(); clear(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, newPin, confirmPin, phase, mustChange, busy, username, sessionLocked]);

  const advanceOrSubmit = () => {
    // OK key: in change mode it steps new -> confirm -> submit.
    if (mustChange) {
      if (phase === 'new') {
        if (newPin.length < 4) {
          setError(ar ? 'الرمز الجديد: 4-8 أرقام' : 'Nouveau code : 4-8 chiffres');
          return;
        }
        setPhase('confirm');
        return;
      }
      void submitChange();
      return;
    }
    void submit();
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (sessionLocked && session) {
        const ok = await unlockSession(pin);
        if (!ok) setError(ar ? 'رمز خاطئ' : 'Code incorrect');
        setPin('');
        return;
      }
      if (!username || pin.length < 4) {
        setError(ar ? 'اختر المستخدم وأدخل الرمز (4-8 أرقام)' : 'Choisissez l’utilisateur et tapez le code (4-8 chiffres)');
        return;
      }
      const r = await login(username, pin);
      if (r.ok) {
        setPin('');
        setActiveView('pos');
        return;
      }
      if (r.mustChange) {
        setOldPin(pin);
        setMustChange(r.mustChange);
        setPhase('new');
        setNewPin('');
        setConfirmPin('');
        setPin('');
        return;
      }
      setError(
        r.locked
          ? (ar ? 'الحساب مقفل بعد 5 محاولات — انتظر ثم أعد المحاولة' : 'Compte verrouillé après 5 essais — réessayez plus tard')
          : (ar ? 'رمز خاطئ أو قاعدة البيانات غير متصلة' : 'Code incorrect ou base injoignable'),
      );
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const submitChange = async () => {
    if (busy || !mustChange) return;
    setError(null);
    if (!/^\d{4,8}$/.test(newPin)) {
      setPhase('new');
      setError(ar ? 'الرمز الجديد: 4-8 أرقام' : 'Nouveau code : 4-8 chiffres');
      return;
    }
    if (newPin !== confirmPin) {
      setError(ar ? 'التأكيد لا يطابق — أعد الإدخال' : 'La confirmation ne correspond pas — recommencez');
      setPhase('new');
      setNewPin('');
      setConfirmPin('');
      return;
    }
    setBusy(true);
    try {
      const ok = await changeSessionPin(mustChange.userId, oldPin, newPin);
      if (!ok) {
        setError(ar ? 'تعذّر تغيير الرمز — تحقق من الاتصال' : 'Changement impossible — vérifiez la connexion');
        return;
      }
      const r2 = await login(mustChange.username, newPin);
      if (r2.ok) {
        setMustChange(null);
        setOldPin('');
        setNewPin('');
        setConfirmPin('');
        setActiveView('pos');
      } else {
        setError(ar ? 'تم التغيير — أعد الدخول بالرمز الجديد' : 'Code changé — reconnectez-vous');
        setMustChange(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const shown = mustChange ? (phase === 'new' ? newPin : confirmPin) : pin;

  return (
    <div className="h-dvh bg-[#0b0f17] text-slate-100 flex items-center justify-center font-sans select-none p-4 overflow-y-auto" dir={ar ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-sm rounded-2xl border border-amber-400/25 bg-[#0e141f] p-4 my-auto shadow-[0_0_60px_rgba(212,175,55,0.12)]">
        <div className="flex flex-col items-center gap-1 mb-3">
          <img src="/brand/baraka-emblem-256.png" alt="Baraka" className="w-14 h-14 rounded-xl object-cover drop-shadow-[0_0_18px_rgba(212,160,23,0.45)]" />
          <h1 className="text-lg font-bold text-amber-300">Baraka Market</h1>
          <p className="text-xs text-slate-400">
            {sessionLocked
              ? (ar ? 'الجلسة مقفلة — أدخل الرمز للمتابعة' : 'Session verrouillée — tapez le code')
              : mustChange
                ? (ar ? 'يجب تغيير الرمز الافتراضي قبل المتابعة' : 'Changez le code par défaut pour continuer')
                : (ar ? 'سجّل الدخول بالرمز للوصول إلى المحل' : 'Identifiez-vous pour ouvrir la caisse')}
          </p>
          <button onClick={toggleLanguage} className="text-[11px] text-slate-500 hover:text-amber-300 underline">
            {ar ? 'Français' : 'العربية'}
          </button>
          {lockNotice && (
            <p className="mt-1 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 text-center">
              {lockNotice}
            </p>
          )}
        </div>

        {!sessionLocked && !mustChange && (
          sessionUsers.length > 0 ? (
            <label className="block mb-2">
              <span className="text-xs text-slate-400">{ar ? 'المستخدم' : 'Utilisateur'}</span>
              <select
                value={username}
                onChange={e => { setUsername(e.target.value); setError(null); }}
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-slate-700 px-3 py-2 text-sm focus:border-amber-400/60 outline-none"
              >
                {sessionUsers.map(u => (
                  <option key={u.id} value={u.username}>
                    {u.display_name} ({u.role}){u.active ? '' : ' — ✕'}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block mb-2">
              <span className="text-xs text-slate-400">{ar ? 'المستخدم (اكتب الاسم)' : 'Utilisateur (saisie libre)'}</span>
              <input
                value={username}
                onChange={e => { setUsername(e.target.value); setError(null); }}
                placeholder="owner"
                dir="ltr"
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-slate-700 px-3 py-2 text-sm focus:border-amber-400/60 outline-none"
              />
            </label>
          )
        )}
        {(sessionLocked || mustChange) && (
          <div className="mb-3 text-center text-sm text-amber-200 font-medium">
            {sessionLocked && session ? session.displayName : mustChange?.username}
          </div>
        )}

        <div className="text-center text-2xl tracking-[0.5em] font-mono mb-2 h-8 text-amber-200" dir="ltr">
          {'•'.repeat(shown.length) || <span className="text-slate-400 text-sm tracking-normal">{ar ? 'أدخل الرمز' : 'Tapez le code'}</span>}
        </div>

        {/* Unified KeyPad language — same caps as the payment keypad. */}
        <KeyPad>
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <Key key={d} onPress={() => press(d)} label={d} />
          ))}
          <Key variant="muted" onPress={clear} label={ar ? 'مسح' : 'Eff.'} />
          <Key onPress={() => press('0')} label="0" />
          <button
            onClick={advanceOrSubmit}
            disabled={busy}
            className="rounded-xl bg-amber-500/90 text-black font-bold py-2.5 text-lg hover:bg-amber-400 disabled:opacity-50 active:scale-95 transition select-none cursor-pointer"
          >
            {busy ? '…' : 'OK'}
          </button>
        </KeyPad>
        <div className="mb-2" />

        {error && <p className="text-center text-sm text-red-400 mb-2">{error}</p>}
        {mustChange && (
          <p className="text-center text-[11px] text-slate-500">
            {phase === 'new'
              ? (ar ? 'أدخل الرمز الجديد ثم OK' : 'Tapez le nouveau code puis OK')
              : (ar ? 'أعد إدخال الرمز للتأكيد ثم OK' : 'Retapez le code pour confirmer puis OK')}
          </p>
        )}
        {session && !sessionLocked && (
          <button onClick={() => void logout()} className="w-full mt-2 text-[11px] text-slate-500 hover:text-slate-300 underline">
            {ar ? 'إلغاء الجلسة المحفوظة' : 'Annuler la session mémorisée'}
          </button>
        )}
      </div>
    </div>
  );
};
