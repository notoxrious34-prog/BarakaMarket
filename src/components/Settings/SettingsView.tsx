import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { auditSessionEvent } from '../../core/session-authority';
import { loadOutbox, OUTBOX_KEY } from '../../core/sale-outbox';
import { StoreProfileView } from './StoreProfileView';
import { ShortcutsSettingsView } from './ShortcutsSettingsView';
import { UsersManagerView } from '../Session/UsersManagerView';
import { AuditLogView } from '../Session/AuditLogView';
import { BackupManagerView } from './BackupManagerView';
import { UpdateManagerView } from './UpdateManagerView';
import { Settings, Users, Database, FileSearch, AlertTriangle, Keyboard } from 'lucide-react';

type Tab = 'fiscal' | 'users' | 'data' | 'audit' | 'shortcuts' | 'danger';

// Local lane keys safe to purge (provisional cache). The sale outbox is
// NEVER wiped here: pending fiscal operations must replay, not vanish.
const PURGE_KEYS = [
  'baraka_products_v2', 'baraka_clients_v2', 'baraka_suppliers_v2',
  'baraka_sales_v2', 'baraka_purchases_v2', 'baraka_settlements_v2',
];

const DangerZone: React.FC<{ isAr: boolean }> = ({ isAr }) => {
  const { session, factoryResetSafe, restoreReferenceScope } = useApp();
  const [msg, setMsg] = useState('');
  const [resetPin, setResetPin] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [scopeProducts, setScopeProducts] = useState(true);
  const [scopeSuppliers, setScopeSuppliers] = useState(true);
  const [scopeClients, setScopeClients] = useState(true);
  const [scopeWorkers, setScopeWorkers] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const isOwner = session?.role === 'owner';
  const isManager = isOwner || session?.role === 'manager';

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

      {/* P3 (v1.4.4): guarded clean-start — mandatory exempt safety snapshot
          first, audited native wipe (numbering restarts 000001), then local
          wipe. Users/SQLite identity, store profile and license are kept. */}
      <div className="border-t border-rose-800/50 pt-3 space-y-2">
        <p className="text-xs font-bold text-rose-200">
          {isAr ? 'بداية آمنة للاستخدام الحقيقي (3 خطوات محمية)' : 'Démarrage sécurisé (3 étapes gardées)'}
        </p>
        <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
          <li>{isAr ? 'لقطة أمان إجبارية معفاة من الحذف (تُحفظ تلقائياً قبل أي مسح)' : 'Snapshot de sécurité obligatoire, exempté de purge (pris avant tout effacement)'}</li>
          <li>{isAr ? 'تصفير أصلي مدقق: مسح دفاتر التجربة + الترقيم يعود 000001' : 'Effacement audité : livres d’essai purgés, numérotation repart à 000001'}</li>
          <li>{isAr ? 'مسح محلي: المنتجات/الموردون/العملاء/المشتريات/المصاريف — تُحفظ الهوية والرخصة' : 'Purge locale : produits/fournisseurs/clients/achats/frais — identité et licence gardées'}</li>
        </ol>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="password"
            inputMode="numeric"
            value={resetPin}
            onChange={e => setResetPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder={isAr ? 'PIN المالك' : 'PIN gérant'}
            disabled={!isOwner || resetBusy}
            className="w-32 px-3 py-2 rounded-xl text-xs bg-[#0b0f17] border border-[#2b3a50] text-slate-200 placeholder:text-slate-500"
          />
          <button
            onClick={() => void (async () => {
              if (!isOwner || resetBusy) return;
              const ok = window.confirm(isAr
                ? 'تأكيد نهائي: لقطة أمان إجبارية ثم تصفير كامل والترقيم يعود 000001؟ (المستخدمون والهوية والرخصة محفوظة)'
                : 'Confirmation finale : snapshot de sécurité puis effacement total, numérotation à 000001 ? (Utilisateurs, identité, licence conservés)');
              if (!ok) return;
              setResetBusy(true);
              try {
                const out = await factoryResetSafe(resetPin);
                setMsg(isAr
                  ? `تم التصفير الآمن — الأرشيف: ${out.archive} — جارٍ إعادة التشغيل…`
                  : `Reset sécurisé — archive : ${out.archive} — redémarrage…`);
              } catch (e) {
                setMsg(isAr ? `مرفوض: ${(e as Error).message}` : `Refusé : ${(e as Error).message}`);
                setResetBusy(false);
              }
            })()}
            disabled={!isOwner || resetBusy || resetPin.length === 0}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${isOwner && resetPin.length > 0 ? 'bg-rose-700 hover:bg-rose-600 text-white cursor-pointer' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}
          >
            {isAr ? 'بداية آمنة (لقطة + تصفير)' : 'Démarrage sécurisé'}
          </button>
        </div>
      </div>
      {/* P3 (v1.4.4): selective restore — reference master-data only.
          Movements, seq counters and carts are never restored. */}
      <div className="border-t border-rose-800/50 pt-3 space-y-2">
        <p className="text-xs font-bold text-rose-200">
          {isAr ? 'استعادة انتقائية للمرجعية فقط' : 'Restauration sélective (référentiel)'}
        </p>
        <p className="text-xs text-slate-400">
          {isAr
            ? 'من ملف لقطة محلية: تُسترجع المنتجات/الموردون/ديون الزبائن/العمال فقط — الحركات والترقيم لا تُمسّ.'
            : 'Depuis un snapshot local : produits/fournisseurs/dettes/workers uniquement — mouvements et numérotation intacts.'}
        </p>
        <div className="flex items-center gap-3 flex-wrap text-xs text-slate-300">
          {([
            [scopeProducts, setScopeProducts, isAr ? 'المنتجات' : 'Produits'],
            [scopeSuppliers, setScopeSuppliers, isAr ? 'الموردون' : 'Fournisseurs'],
            [scopeClients, setScopeClients, isAr ? 'ديون الزبائن' : 'Dettes clients'],
            [scopeWorkers, setScopeWorkers, isAr ? 'العمال' : 'Workers'],
          ] as [boolean, (v: boolean) => void, string][]).map(([v, set, label]) => (
            <label key={label} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={v} disabled={!isManager || restoreBusy} onChange={e => set(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            accept="application/json,.json"
            disabled={!isManager || restoreBusy}
            onChange={e => void (async () => {
              const f = e.target.files?.[0];
              if (!f || !isManager) return;
              setRestoreBusy(true);
              try {
                const text = await f.text();
                const keys = await restoreReferenceScope(text, {
                  products: scopeProducts, suppliers: scopeSuppliers, clients: scopeClients, workers: scopeWorkers,
                });
                setMsg(isAr
                  ? `تمت الاستعادة الانتقائية (${keys.length}): ${keys.join('، ')} — جارٍ إعادة التحميل…`
                  : `Restauration sélective (${keys.length}) : ${keys.join(', ')} — rechargement…`);
                window.setTimeout(() => window.location.reload(), 1500);
              } catch (err) {
                setMsg(isAr ? `مرفوضة: ${(err as Error).message}` : `Refusée : ${(err as Error).message}`);
                setRestoreBusy(false);
              }
            })()}
            className="text-xs text-slate-300 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:text-xs file:font-bold file:bg-emerald-700 file:text-white hover:file:bg-emerald-600 file:border-0 file:cursor-pointer"
          />
        </div>
      </div>
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
    { id: 'shortcuts', label: isAr ? 'الاختصارات' : 'Raccourcis', icon: <Keyboard className="w-3.5 h-3.5" /> },
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
      {tab === 'shortcuts' && <ShortcutsSettingsView />}
      {tab === 'danger' && <DangerZone isAr={isAr} />}
    </div>
  );
};
