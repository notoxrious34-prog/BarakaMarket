import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { LocalSnapshotPanel } from '../Inventory/ProductToolModals';

const API = 'http://127.0.0.1:3100';

interface BackupRow {
  id: string; filename: string; filePath: string; fileSizeBytes: number;
  sha256Checksum: string; salesCount: number; productsCount: number;
  status: 'VERIFIED' | 'CORRUPT' | 'RESTORED'; createdAt: string;
}

export const BackupManagerView: React.FC = () => {
  const { language } = useApp();
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

  const run = async (url: string, body: unknown, okMsg: string) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'error');
      setMsg(j.isValid === false ? `${isAr ? 'التحقق: تالف — ' : 'Vérif: CORROMPU — '}${(j.errors ?? []).join('; ')}` : okMsg);
      await refresh();
    } catch (e) {
      setMsg(`${isAr ? 'خطأ: ' : 'Erreur: '}${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const mb = (b: number) => `${(b / 1048576).toFixed(2)} MB`;
  const card = 'bg-[#101724] border border-[#1e293b] rounded-xl p-4';

  return (
    <div className="space-y-4">
      {/* ADR-018: offline lane — always available, no server needed. */}
      <LocalSnapshotPanel isAr={isAr} />
      {/* Fiscal SQLite lane — rendered only when the loopback server answers. No error banners. */}
      {!offline && (
      <div className={card}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-white">{isAr ? 'النسخ الاحتياطي الساخن (SQLite)' : 'Sauvegarde à chaud (SQLite)'}</h3>
        <button
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white cursor-pointer"
          onClick={() => void run(`${API}/api/backups/create`, { label: 'manual-ui' }, isAr ? 'تم إنشاء النسخة' : 'Snapshot créé')}
        >
          {isAr ? 'إنشاء نسخة فورية' : 'Créer Sauvegarde'}
        </button>
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
            <div className="flex gap-2 mt-1.5">
              <button disabled={busy} className="text-emerald-300 hover:text-emerald-200 cursor-pointer disabled:opacity-40" onClick={() => void run(`${API}/api/backups/verify`, { backupPath: b.filePath }, isAr ? 'النسخة سليمة' : 'Snapshot vérifié')}>
                {isAr ? 'تحقق' : 'Vérifier'}
              </button>
              <button disabled={busy} className="text-amber-300 hover:text-amber-200 cursor-pointer disabled:opacity-40" onClick={() => { if (window.confirm(isAr ? 'استعادة آمنة مع حجر صحي؟' : 'Restauration avec quarantaine ?')) void run(`${API}/api/backups/restore`, { backupPath: b.filePath }, isAr ? 'تمت الاستعادة' : 'Restauré'); }}>
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
