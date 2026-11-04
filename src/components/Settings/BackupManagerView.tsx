import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { auditSessionEvent } from '../../core/session-authority.js';
import { getLoopbackToken } from '../../core/fiscal-authority.js';
import { backupAgeLabel } from '../../core/backup-catalog.js';
import { LocalSnapshotPanel } from '../Inventory/ProductToolModals';

const API = 'http://127.0.0.1:3100';

interface BackupRow {
  id: string; filename: string; filePath: string; fileSizeBytes: number;
  sha256Checksum: string; salesCount: number; productsCount: number;
  status: 'VERIFIED' | 'CORRUPT' | 'RESTORED'; createdAt: string;
  label?: string; appVersion?: string; schemaVersion?: number;
  /** P3 (v1.4.4): pre-reset safety archive — never pruned. */
  exempt?: boolean;
}

export const BackupManagerView: React.FC = () => {
  const { language, session } = useApp();
  const isAr = language === 'ar';
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [offline, setOffline] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/backups`);
      if (!r.ok) throw new Error();
      setRows(await r.json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const audit = (action: 'backup.create' | 'backup.restore', detail: string) => {
    if (session) void auditSessionEvent(session.username, action, detail).catch(() => {});
  };

  const run = async (url: string, body: unknown, okMsg: string, auditAction?: 'backup.create' | 'backup.restore') => {
    setBusy(true);
    try {
      // T4 (ADR-025): loopback writes are token-gated by design. In the
      // installed app the native shell relays the token; in plain-browser
      // preview there is none — say so plainly instead of a raw 401.
      const token = await getLoopbackToken();
      if (!token) {
        setMsg(isAr
          ? 'النسخ الساخن يعمل في التطبيق المثبت فقط — في وضع المتصفح استعمل «النسخة المحلية» أعلاه.'
          : 'Sauvegarde à chaud réservée à l’app installée — en mode navigateur, utilisez le « Snapshot local » ci-dessus.');
        return;
      }
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-baraka-loopback': token }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'error');
      setMsg(j.isValid === false ? `${isAr ? 'التحقق: تالف — ' : 'Vérif: CORROMPU — '}${(j.errors ?? []).join('; ')}` : okMsg);
      if (auditAction) audit(auditAction, typeof body === 'object' ? JSON.stringify(body) : String(body));
      await refresh();
    } catch (e) {
      setMsg(`${isAr ? 'خطأ: ' : 'Erreur: '}${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const download = (b: BackupRow, kind: 'db' | 'manifest') => {
    const a = document.createElement('a');
    a.href = `${API}/api/backups/file?backupPath=${encodeURIComponent(b.filename)}&kind=${kind}`;
    a.download = kind === 'manifest' ? `${b.filename}.manifest.json` : b.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const mb = (b: number) => `${(b / 1048576).toFixed(2)} MB`;
  const card = 'bg-[#101724] border border-[#1e293b] rounded-xl p-4';
  const totalBytes = rows.reduce((a, b) => a + b.fileSizeBytes, 0);
  const last = rows[0];
  // P3: retention counts non-exempt snapshots only; exempt safety archives sit outside the 30.
  const retainedCount = rows.filter(b => b.exempt !== true).length;

  return (
    <div className="space-y-4">
      {/* ADR-018: offline lane — always available, no server needed. */}
      <LocalSnapshotPanel isAr={isAr} audit={audit} />
      {/* Fiscal SQLite lane — rendered only when the loopback server answers. No error banners. */}
      {!offline && (
      <div className={card}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-white">{isAr ? 'النسخ الاحتياطي الساخن (SQLite)' : 'Sauvegarde à chaud (SQLite)'}</h3>
        <button
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white cursor-pointer"
          onClick={() => void run(`${API}/api/backups/create`, { label: 'manual-ui' }, isAr ? 'تم إنشاء النسخة' : 'Snapshot créé', 'backup.create')}
        >
          {isAr ? 'إنشاء نسخة فورية' : 'Créer Sauvegarde'}
        </button>
      </div>
      {/* Backup-Pro: status header — fleet-grade at a glance, even at zero. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-[11px]">
        <div className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg p-2">
          <div className="text-slate-500">{isAr ? 'النسخ' : 'Snapshots'}</div>
          <div className="text-white font-bold font-mono" dir="ltr">{retainedCount} / 30</div>
        </div>
        <div className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg p-2">
          <div className="text-slate-500">{isAr ? 'الحجم الكلي' : 'Taille totale'}</div>
          <div className="text-white font-bold font-mono" dir="ltr">{mb(totalBytes)}</div>
        </div>
        <div className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg p-2">
          <div className="text-slate-500">{isAr ? 'آخر نسخة' : 'Dernier'}</div>
          <div className="text-white font-bold">{last ? backupAgeLabel(last.createdAt, Date.now(), isAr) : '—'}</div>
        </div>
        <div className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg p-2">
          <div className="text-slate-500">{isAr ? 'الاحتفاظ' : 'Rétention'}</div>
          <div className="text-amber-300 font-bold">{isAr ? 'آخر 30 نسخة' : '30 derniers'}</div>
        </div>
      </div>
      {msg && <div className="text-[11px] text-slate-300 bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 mb-3">{msg}</div>}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {rows.length === 0 && (
          <div className="text-[11px] text-slate-500">{isAr ? 'لا نسخ بعد.' : 'Aucun snapshot.'}</div>
        )}
        {rows.map(b => (
          <div key={b.id} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-lg p-2.5 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-200 font-mono truncate">{b.filename}</span>
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${b.status === 'VERIFIED' ? 'bg-emerald-500/10 text-emerald-300' : b.status === 'RESTORED' ? 'bg-sky-500/10 text-sky-300' : 'bg-rose-500/10 text-rose-300'}`}>
                {b.status}
              </span>
            </div>
            <div className="text-slate-500 font-mono mt-0.5">sha256 {b.sha256Checksum.slice(0, 24)}… · {mb(b.fileSizeBytes)}</div>
            <div className="text-slate-500 font-mono mt-0.5">
              {new Date(b.createdAt).toLocaleString(isAr ? 'ar-DZ' : 'fr-FR')} · {b.salesCount} {isAr ? 'مبيعات' : 'ventes'} · {b.productsCount} {isAr ? 'منتجات' : 'produits'}
            </div>
            <div className="text-slate-500 font-mono mt-0.5">
              {b.label && <span className="text-sky-300">[{b.label}] </span>}
              {b.exempt === true && <span className="text-amber-300 font-bold">{isAr ? '[أمان — معفاة من الحذف] ' : '[sécurité — exemptée] '}</span>}
              {b.appVersion && <span>v{b.appVersion} </span>}
              {typeof b.schemaVersion === 'number' && b.schemaVersion > 0 && <span>schema v{b.schemaVersion} </span>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
              <button disabled={busy} className="text-emerald-300 hover:text-emerald-200 cursor-pointer disabled:opacity-40" onClick={() => void run(`${API}/api/backups/verify`, { backupPath: b.filePath }, isAr ? 'النسخة سليمة' : 'Snapshot vérifié')}>
                {isAr ? 'تحقق' : 'Vérifier'}
              </button>
              <button disabled={busy} className="text-sky-300 hover:text-sky-200 cursor-pointer disabled:opacity-40" onClick={() => download(b, 'db')}>
                {isAr ? 'تنزيل (USB)' : 'Télécharger (USB)'}
              </button>
              <button disabled={busy} className="text-slate-400 hover:text-slate-200 cursor-pointer disabled:opacity-40" onClick={() => download(b, 'manifest')}>
                manifest
              </button>
              <button disabled={busy} className="text-amber-300 hover:text-amber-200 cursor-pointer disabled:opacity-40" onClick={() => { if (window.confirm(isAr ? `استعادة آمنة مع حجر صحي؟\n${b.filename}` : `Restauration avec quarantaine ?\n${b.filename}`)) void run(`${API}/api/backups/restore`, { backupPath: b.filePath }, isAr ? 'تمت الاستعادة' : 'Restauré', 'backup.restore'); }}>
                {isAr ? 'استعادة' : 'Restaurer'}
              </button>
            </div>
          </div>
        ))}
      </div>
      </div>
      )}
    </div>
  );
};
