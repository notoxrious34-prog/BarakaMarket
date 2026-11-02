import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { auditSessionEvent } from '../../core/session-authority';
import { loadOutbox, OUTBOX_KEY } from '../../core/sale-outbox';
import { StoreProfileView } from './StoreProfileView';
import { UsersManagerView } from '../Session/UsersManagerView';
import { AuditLogView } from '../Session/AuditLogView';
import { BackupManagerView } from './BackupManagerView';
import { UpdateManagerView } from './UpdateManagerView';
import { Settings, Users, Database, FileSearch, AlertTriangle } from 'lucide-react';

type Tab = 'fiscal' | 'users' | 'data' | 'audit' | 'danger';

// Local lane keys safe to purge (provisional cache). The sale outbox is
// NEVER wiped here: pending fiscal operations must replay, not vanish.
const PURGE_KEYS = [
  'baraka_products_v2', 'baraka_clients_v2', 'baraka_suppliers_v2',
  'baraka_sales_v2', 'baraka_purchases_v2', 'baraka_settlements_v2',
];

const DangerZone: React.FC<{ isAr: boolean }> = ({ isAr }) => {
  const { session } = useApp();
  const [msg, setMsg] = useState('');
  const isOwner = session?.role === 'owner';

  const purge = async () => {
    if (!isOwner || !session) return;
    const pending = loadOutbox(localStorage).length;
    if (pending > 0) {
      setMsg(isAr
        ? `ممنوع: توجد ${pending} عملية بانتظار الإرسال للقاعدة — أرسلها أولاً.`
        : `Refusé : ${pending} opération(s) en attente — synchronisez d'abord.`);
      return;
    }
    const ok = window.confirm(isAr
      ? 'مسح ذاكرة التخزين المحلية المؤقتة؟ (القاعدة المحلية SQLite لا تُمس) — سيُسجَّل في التدقيق.'
      : 'Purger le cache local ? (SQLite intact) — sera audité.');
    if (!ok) return;
    await auditSessionEvent(session.username, 'profile.change', 'danger: provisional cache purge by owner');
    for (const k of PURGE_KEYS) localStorage.removeItem(k);
    // OUTBOX_KEY intentionally untouched; session survives too.
    void OUTBOX_KEY;
    window.location.reload();
  };

  return (
    <div className="bg-[#111722] border border-rose-800/60 rounded-2xl p-5 space-y-3">
      <h3 className="text-sm font-bold text-rose-300 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        <span>{isAr ? 'منطقة الخطر' : 'Zone dangereuse'}</span>
      </h3>
      <p className="text-xs text-slate-400">
        {isAr
          ? 'مسح البيانات المؤقتة بالمتصفح (المسودات والذاكرة) عند التعليق. القاعدة SQLite والرخصة لا تُمسّان. يُمنع المسح أثناء وجود عمليات معلقة.'
          : 'Purge du cache navigateur (brouillons) en cas de blocage. SQLite et licence intacts. Interdit si des opérations sont en attente.'}
      </p>
      {!isOwner && (
        <p className="text-xs text-amber-200">{isAr ? 'مقتصر على المالك.' : 'Réservé au gérant.'}</p>
      )}
      <button
        onClick={() => void purge()}
        disabled={!isOwner}
        className={`px-4 py-2 rounded-xl text-xs font-bold ${isOwner ? 'bg-rose-700 hover:bg-rose-600 text-white cursor-pointer' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}
      >
        {isAr ? 'مسح الذاكرة المؤقتة' : 'Purger le cache'}
      </button>
      {msg && <p className="text-xs text-amber-200">{msg}</p>}
    </div>
  );
};

/**
 * B5: tabbed settings — جباية ومحل / مستخدمون / نسخ وتحديث / تدقيق / خطر.
 * Explicit save stays inside StoreProfileView (handleSubmit + toast).
 */
export const SettingsView: React.FC = () => {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [tab, setTab] = useState<Tab>('fiscal');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'fiscal', label: isAr ? 'الجباية والمحل' : 'Fiscal & Magasin', icon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'users', label: isAr ? 'المستخدمون' : 'Utilisateurs', icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'data', label: isAr ? 'النسخ والتحديث' : 'Sauvegarde & MAJ', icon: <Database className="w-3.5 h-3.5" /> },
    { id: 'audit', label: isAr ? 'التدقيق' : 'Audit', icon: <FileSearch className="w-3.5 h-3.5" /> },
    { id: 'danger', label: isAr ? 'خطر' : 'Danger', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex gap-1.5 flex-wrap" role="tablist">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${tab === t.id
              ? 'bg-amber-600 text-white'
              : t.id === 'danger' ? 'bg-[#111722] text-rose-300 border border-rose-800/50 hover:bg-rose-950/50'
              : 'bg-[#111722] text-slate-300 border border-[#1e293b] hover:bg-[#162030]'}`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      {tab === 'fiscal' && <StoreProfileView />}
      {tab === 'users' && <UsersManagerView />}
      {tab === 'data' && (<div className="space-y-4"><BackupManagerView /><UpdateManagerView /></div>)}
      {tab === 'audit' && <AuditLogView />}
      {tab === 'danger' && <DangerZone isAr={isAr} />}
    </div>
  );
};
