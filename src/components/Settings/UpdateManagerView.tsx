import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { isTauriRuntime } from '../../core/fiscal-authority';
import {
  checkForUpdate, relaunchApp, RELEASES_URL,
  type PendingUpdate, type UpdateStatus,
} from '../../core/update-lane';
import { auditSessionEvent } from '../../core/session-authority';

/**
 * T9 (ADR-032) — update manager. Checking is free for every role; install is
 * manager+ (owner/manager) and always a deliberate tap — never background.
 * Offline or USB-only shops install by hand from the Releases page; this lane
 * only automates the same signed bundle.
 */
export const UpdateManagerView: React.FC = () => {
  const { language, session } = useApp();
  const ar = language === 'ar';
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [pending, setPending] = useState<PendingUpdate | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const canInstall = !!session && session.role !== 'cashier';
  const current = '1.1.0'; // bumped with package.json + tauri.conf.json per release

  const check = async () => {
    setBusy(true);
    setDone(null);
    try {
      const r = await checkForUpdate(current);
      setStatus(r.status);
      setPending(r.pending);
      if (session) void auditSessionEvent(session.username, 'update.check', r.status.latest ?? r.status.reason);
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!pending || !session) return;
    setBusy(true);
    try {
      await auditSessionEvent(session.username, 'update.install', pending.version);
      await pending.install();
      const relaunched = await relaunchApp();
      setDone(
        relaunched
          ? (ar ? 'يُعاد التشغيل الآن…' : 'Redémarrage…')
          : (ar ? 'تم التثبيت — أغلق التطبيق وأعد فتحه' : 'Installé — fermez et rouvrez l’application'),
      );
      setPending(null);
    } catch (e) {
      setStatus(s => (s ? { ...s, reason: 'error', detail: String((e as Error)?.message ?? e).slice(0, 160) } : s));
    } finally {
      setBusy(false);
    }
  };

  const reasonText = (s: UpdateStatus): string => {
    switch (s.reason) {
      case 'native-only':
        return ar ? 'التحديث التلقائي داخل التطبيق المنصّب فقط — في المتصفح ثبّت من USB أو المثبت' : 'MAJ auto dans l’app installée uniquement — via USB/installateur dans le navigateur';
      case 'up-to-date':
        return ar ? `محدّث — آخر نسخة ${s.latest ?? s.current}` : `À jour — ${s.latest ?? s.current}`;
      case 'found':
        return ar ? `نسخة جديدة ${s.latest} متوفرة` : `Nouvelle version ${s.latest} disponible`;
      case 'error':
        return `${ar ? 'تعذّر التحقق' : 'Échec'}: ${s.detail ?? ''}`;
    }
  };

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-[#0e141f] p-4">
      <h2 className="font-bold text-amber-300 mb-1">{ar ? 'التحديثات' : 'Mises à jour'}</h2>
      <p className="text-xs text-slate-500 mb-3">
        {ar ? `النسخة الحالية ${current}` : `Version actuelle ${current}`}
        {!isTauriRuntime() && (ar ? ' (وضع المتصفح)' : ' (navigateur)')}
        {' · '}
        <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="underline hover:text-amber-300">
          {ar ? 'صفحة الإصدارات (USB)' : 'Page des versions (USB)'}
        </a>
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void check()}
          disabled={busy}
          className="rounded-lg bg-[#162030] border border-slate-700 px-3 py-1.5 text-sm hover:border-amber-400/50 disabled:opacity-50"
        >
          {busy ? '…' : (ar ? 'التحقق من التحديثات' : 'Vérifier')}
        </button>
        {status?.available && pending && canInstall && (
          <button
            onClick={() => void install()}
            disabled={busy}
            className="rounded-lg bg-amber-500/90 text-black text-sm font-bold px-3 py-1.5 hover:bg-amber-400 disabled:opacity-50"
          >
            {ar ? `تثبيت ${pending.version} وإعادة التشغيل` : `Installer ${pending.version} + redémarrer`}
          </button>
        )}
      </div>
      {status && <p className="mt-2 text-xs text-slate-300">{reasonText(status)}</p>}
      {status?.notes && (
        <pre className="mt-2 text-[11px] text-slate-400 whitespace-pre-wrap max-h-32 overflow-y-auto" dir="auto">
          {status.notes}
        </pre>
      )}
      {done && <p className="mt-2 text-xs text-emerald-400">{done}</p>}
      {!canInstall && (
        <p className="mt-2 text-[11px] text-slate-500">
          {ar ? 'التثبيت للمدير/المالك فقط — اطلب من المسؤول' : 'Installation réservée au gérant/propriétaire'}
        </p>
      )}
    </div>
  );
};
