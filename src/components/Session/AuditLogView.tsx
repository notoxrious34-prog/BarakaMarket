import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import { listAuditEvents, type AuditListRow } from '../../core/session-authority';

/**
 * T8 (ADR-031) — security audit trail, manager+. Self-gating. Read-only:
 * rows are written by the DAL (login/lockout/user changes) and the session
 * bridge (logout/lock/unlock), never edited here.
 */
export const AuditLogView: React.FC = () => {
  const { language, session } = useApp();
  const ar = language === 'ar';
  const [rows, setRows] = useState<AuditListRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void listAuditEvents(100).then(r => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, []);

  if (!session || !can(session.role, 'audit.view')) return null;

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-[#0e141f] p-4">
      <h2 className="font-bold text-amber-300 mb-3">{ar ? 'سجل التدقيق الأمني (آخر 100)' : 'Journal d’audit (100 derniers)'}</h2>
      {rows === null ? (
        <p className="text-sm text-slate-500">{ar ? '…' : '…'}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">{ar ? 'لا أحداث بعد' : 'Aucun événement'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" dir="ltr">
            <thead>
              <tr className="text-slate-500 text-left border-b border-slate-800">
                <th className="py-1 pr-2">ts</th>
                <th className="py-1 pr-2">actor</th>
                <th className="py-1 pr-2">action</th>
                <th className="py-1 pr-2">entity</th>
                <th className="py-1">detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
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
