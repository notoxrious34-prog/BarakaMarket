import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import { listAuditEvents, type AuditListRow } from '../../core/session-authority';
import { buildAuditCsv, auditCsvFilename, downloadTextFile } from '../../core/csv-exporter';
import { Download } from 'lucide-react';

/**
 * v1.5.1 §2 (USERS-PLUS) — user timeline: every audit row for one actor on
 * one page, with action filter + free-text search + CSV export (same `;`+BOM
 * convention as the stock exporter). Read-only; manager+. Rows come from the
 * existing `listAuditEvents(500)` lane — no new endpoint, both lanes alike.
 */
export const UserTimelineView: React.FC = () => {
  const { language, session, sessionUsers, refreshSessionUsers } = useApp();
  const ar = language === 'ar';
  const [rows, setRows] = useState<AuditListRow[] | null>(null);
  const [actor, setActor] = useState<string>('');
  const [action, setAction] = useState<string>('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    void refreshSessionUsers().then(() => {
      if (!alive) return;
      void listAuditEvents(500).then(r => { if (alive) setRows(r); });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows ?? []) s.add(r.action);
    return [...s].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter(r => {
      if (actor && r.actor !== actor) return false;
      if (action && r.action !== action) return false;
      if (!q) return true;
      return [r.ts, r.actor, r.action, r.entity, r.entity_id, r.detail]
        .join(' ').toLowerCase().includes(q);
    });
  }, [rows, actor, action, query]);

  if (!session || !can(session.role, 'audit.view')) return null;

  const exportCsv = () => {
    downloadTextFile(auditCsvFilename(actor || 'all'), buildAuditCsv(filtered));
  };

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-[#0e141f] p-4">
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-bold text-amber-300">{ar ? 'الخط الزمني للمستخدم' : 'Chronologie utilisateur'}</h2>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          {ar ? `تصدير CSV (${filtered.length})` : `Exporter CSV (${filtered.length})`}
        </button>
      </div>
      <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select
          value={actor}
          onChange={e => setActor(e.target.value)}
          className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60"
        >
          <option value="">{ar ? 'كل المستخدمين' : 'Tous les utilisateurs'}</option>
          {sessionUsers.map(u => (
            <option key={u.id} value={u.username}>{u.display_name} @{u.username}</option>
          ))}
        </select>
        <select
          value={action}
          onChange={e => setAction(e.target.value)}
          className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60"
        >
          <option value="">{ar ? 'كل الأحداث' : 'Toutes les actions'}</option>
          {actions.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <input
          value={query}
          onChange={e => setQuery(e.target.value.slice(0, 80))}
          placeholder={ar ? 'بحث في التفاصيل…' : 'Rechercher…'}
          className="rounded-lg bg-[#0b0f17] border border-slate-700 px-2 py-1.5 text-sm outline-none focus:border-amber-400/60 placeholder:text-slate-600"
        />
      </div>
      {rows === null ? (
        <p className="text-sm text-slate-500">{ar ? 'جارٍ التحميل…' : 'Chargement…'}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">{ar ? 'لا أحداث مطابقة.' : 'Aucun événement.'}</p>
      ) : (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs" dir="ltr">
            <thead className="sticky top-0 bg-[#0e141f]">
              <tr className="text-slate-500 text-left border-b border-slate-800">
                <th className="py-1 pr-2">ts</th>
                <th className="py-1 pr-2">actor</th>
                <th className="py-1 pr-2">action</th>
                <th className="py-1 pr-2">entity</th>
                <th className="py-1">detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-slate-800/50 text-slate-300">
                  <td className="py-1 pr-2 whitespace-nowrap text-slate-500">{r.ts}</td>
                  <td className="py-1 pr-2 font-medium">{r.actor}</td>
                  <td className="py-1 pr-2 text-amber-200/90">{r.action}</td>
                  <td className="py-1 pr-2 text-slate-400">{r.entity ? `${r.entity}:${r.entity_id}` : ''}</td>
                  <td className="py-1 text-slate-400">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
