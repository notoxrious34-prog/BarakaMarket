import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import { formatDZD } from '../../core/display';
import type { ExpenseCategory } from '../../types';
import { tillOutcomeLabel } from '../../core/till-outcome';
import type { TillOutcome } from '../../core/till-outcome';

const CATS: { v: ExpenseCategory; ar: string; fr: string }[] = [
  { v: 'LOYER', ar: 'كراء المحل', fr: 'Loyer' },
  { v: 'ELEC_EAU', ar: 'كهرباء وماء', fr: 'Électricité / Eau' },
  { v: 'TRANSPORT', ar: 'نقل', fr: 'Transport' },
  { v: 'MAINTENANCE', ar: 'صيانة', fr: 'Maintenance' },
  { v: 'TELECOM', ar: 'هاتف وأنترنت', fr: 'Télécom' },
  { v: 'SALAIRES', ar: 'رواتب (عبر التسوية)', fr: 'Salaires (paie)' },
  { v: 'AVANCES', ar: 'سلف (عبر العامل)', fr: 'Avances (employé)' },
  { v: 'AUTRE', ar: 'مصروف آخر', fr: 'Autre' },
];

const catLabel = (c: ExpenseCategory, isAr: boolean) =>
  CATS.find(x => x.v === c)?.[isAr ? 'ar' : 'fr'] ?? c;

/** P2 (v1.4.4): shop expenses + worker advance-against-salary accounts (Compta tab). */
export const ExpensesWorkersView: React.FC = () => {
  const {
    expenses, workers, advances, salarySettlements, session,
    recordExpense, addWorker, deactivateWorker, recordAdvance, settleSalary, language,
  } = useApp();
  const isAr = language === 'ar';
  const role = session?.role ?? 'cashier';
  const manageWorkers = can(role, 'worker.manage');
  const settlePay = can(role, 'payroll.settle');

  const [sub, setSub] = useState<'depenses' | 'employes'>('depenses');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // expense form
  const today = new Date().toISOString().slice(0, 10);
  const [eCat, setECat] = useState<ExpenseCategory>('LOYER');
  const [eAmt, setEAmt] = useState('');
  const [eMethod, setEMethod] = useState<'ESPECES' | 'VIREMENT' | 'CHEQUE'>('ESPECES');
  const [eNote, setENote] = useState('');

  // worker form
  const [wName, setWName] = useState('');
  const [wPhone, setWPhone] = useState('');
  const [wPost, setWPost] = useState('');
  const [wSalary, setWSalary] = useState('');

  // advance form
  const [aWorker, setAWorker] = useState('');
  const [aAmt, setAAmt] = useState('');
  const [aNote, setANote] = useState('');

  // payday
  const [pWorker, setPWorker] = useState('');
  const [pMonth, setPMonth] = useState(new Date().toISOString().slice(0, 7));

  const input = 'w-full bg-[#111722] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500';
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors disabled:opacity-50';
  const card = 'bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl';

  const run = async (fn: () => Promise<unknown>, okMsg: (r: unknown) => string) => {
    setBusy(true); setMsg('');
    try { setMsg(okMsg(await fn())); } catch (e) { setMsg(`${isAr ? 'خطأ: ' : 'Erreur: '}${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const monthAdvances = (workerId: number, month: string) =>
    advances.filter(a => a.workerId === workerId && a.date.startsWith(month)).reduce((s, a) => s + a.amountCt, 0);

  const totalExpensesCt = expenses.reduce((s, e) => s + e.amountCt, 0);

  return (
    <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-[#1e293b] pb-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25">03</span>
          {isAr ? 'مصاريف المحل وحسابات العمال' : 'Dépenses & Employés'}
        </h3>
        <div className="flex gap-1 bg-[#0b0f17] rounded-lg p-0.5">
          {(['depenses', 'employes'] as const).map(t => (
            <button key={t} onClick={() => setSub(t)}
              className={`px-3 py-1 rounded-md text-[11px] font-bold cursor-pointer ${sub === t ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t === 'depenses' ? (isAr ? 'المصاريف' : 'Dépenses') : (isAr ? 'العمال' : 'Employés')}
            </button>
          ))}
        </div>
      </div>

      {msg && <div className="text-[11px] text-slate-300 bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2">{msg}</div>}

      {sub === 'depenses' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الفئة' : 'Catégorie'}</label>
              <select className={input} value={eCat} onChange={e => setECat(e.target.value as ExpenseCategory)}>
                {CATS.filter(c => c.v !== 'SALAIRES' && c.v !== 'AVANCES').map(c => (
                  <option key={c.v} value={c.v}>{isAr ? c.ar : c.fr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'المبلغ (دج)' : 'Montant (DZD)'}</label>
              <input className={`${input} font-mono`} dir="ltr" type="number" min="0" value={eAmt} onChange={e => setEAmt(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الطريقة' : 'Moyen'}</label>
              <select className={input} value={eMethod} onChange={e => setEMethod(e.target.value as typeof eMethod)}>
                <option value="ESPECES">{isAr ? 'نقداً (من الصندوق)' : 'Espèces (caisse)'}</option>
                <option value="VIREMENT">{isAr ? 'تحويل' : 'Virement'}</option>
                <option value="CHEQUE">{isAr ? 'شيك' : 'Chèque'}</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'ملاحظة' : 'Note'}</label>
              <input className={input} value={eNote} onChange={e => setENote(e.target.value)} />
            </div>
          </div>
          <button disabled={busy} onClick={() => void run(
            () => recordExpense({ date: today, category: eCat, amountDzd: Number(eAmt), method: eMethod, note: eNote || undefined }),
            r => `${isAr ? 'سُجل' : 'Enregistré'} ${(r as { id: string }).id} — ${tillOutcomeLabel((r as { tillOutcome?: TillOutcome }).tillOutcome ?? ((r as { tillPosted: boolean }).tillPosted ? 'posted' : 'no-session'), isAr)}`,
          )} className={`${btn} bg-amber-600 hover:bg-amber-500 text-white`}>
            {isAr ? 'تسجيل المصروف' : 'Enregistrer la dépense'}
          </button>

          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead className="bg-[#0b0f17] text-slate-400 uppercase text-[10px] border-b border-[#1e293b]">
                <tr>
                  <th className="py-2 px-3 text-start">{isAr ? 'التاريخ' : 'Date'}</th>
                  <th className="py-2 px-3 text-start">{isAr ? 'الفئة' : 'Catégorie'}</th>
                  <th className="py-2 px-3 text-start">{isAr ? 'البيان' : 'Libellé'}</th>
                  <th className="py-2 px-3 text-start">{isAr ? 'الصندوق' : 'Caisse'}</th>
                  <th className="py-2 px-3 text-end">{isAr ? 'المبلغ' : 'Montant'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#162030] text-slate-300">
                {[...expenses].reverse().slice(0, 50).map(e => (
                  <tr key={e.id} className="hover:bg-[#162030]/60">
                    <td className="py-2 px-3 font-mono text-[11px]">{e.date}</td>
                    <td className="py-2 px-3 text-amber-300">{catLabel(e.category, isAr)}</td>
                    <td className="py-2 px-3">{e.note ?? '—'}</td>
                    <td className="py-2 px-3 text-[11px]">{e.tillPosted ? (isAr ? 'من الصندوق ✓' : 'caisse ✓') : (isAr ? 'خارج الصندوق' : 'hors-caisse')}</td>
                    <td className="py-2 px-3 text-end font-mono font-bold text-white" dir="ltr">{formatDZD(e.amountCt / 100, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expenses.length === 0 && <div className="text-[11px] text-slate-500 py-3 text-center">{isAr ? 'لا مصاريف مسجلة بعد' : 'Aucune dépense'}</div>}
          </div>
          <div className="text-xs text-slate-400">
            {isAr ? 'المجموع: ' : 'Total: '}<strong className="text-amber-300 font-mono" dir="ltr">{formatDZD(totalExpensesCt / 100, false)}</strong>
          </div>
        </>
      )}

      {sub === 'employes' && (
        <>
          {manageWorkers && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-[#0b0f17] border border-[#1e293b] rounded-xl p-3">
              <div className="sm:col-span-2">
                <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الاسم' : 'Nom'}</label>
                <input className={input} value={wName} onChange={e => setWName(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الهاتف' : 'Tél'}</label>
                <input className={input} value={wPhone} onChange={e => setWPhone(e.target.value)} dir="ltr" />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'المنصب' : 'Poste'}</label>
                <input className={input} value={wPost} onChange={e => setWPost(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الراتب الشهري (دج)' : 'Salaire (DZD)'}</label>
                <input className={`${input} font-mono`} dir="ltr" type="number" min="0" value={wSalary} onChange={e => setWSalary(e.target.value)} />
              </div>
              <div className="sm:col-span-5">
                <button disabled={busy} onClick={() => void run(
                  async () => { const w = addWorker({ name: wName, phone: wPhone, post: wPost, baseSalaryCt: Math.round(Number(wSalary) * 100) }); setWName(''); setWPhone(''); setWPost(''); setWSalary(''); return w; },
                  r => `${isAr ? 'عامل جديد: ' : 'Employé: '}${(r as { name: string }).name}`,
                )} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}>
                  {isAr ? 'إضافة عامل' : 'Ajouter employé'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {workers.filter(w => w.active).map(w => (
              <div key={w.id} className="bg-[#0b0f17] border border-[#1e293b] rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-white">{w.name} <span className="text-slate-500 font-normal">· {w.post || '—'} · {w.phone || '—'}</span></div>
                  <div className="text-[11px]">
                    <span className="text-slate-500">{isAr ? 'الراتب: ' : 'Salaire: '}</span>
                    <strong className="font-mono text-white" dir="ltr">{formatDZD(w.baseSalaryCt / 100, false)}</strong>
                    <span className="text-slate-500 ms-3">{isAr ? 'السلف المستحقة: ' : 'Avances dues: '}</span>
                    <strong className={`font-mono ${w.balanceCt > 0 ? 'text-rose-300' : 'text-emerald-300'}`} dir="ltr">{formatDZD(w.balanceCt / 100, false)}</strong>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                  <div className="flex gap-1">
                    <input className={`${input} font-mono`} dir="ltr" type="number" min="0" placeholder={isAr ? 'سلفة (دج)' : 'Avance (DZD)'}
                      value={aWorker === String(w.id) ? aAmt : ''} onChange={e => { setAWorker(String(w.id)); setAAmt(e.target.value); }} />
                    <button disabled={busy} onClick={() => void run(
                      () => recordAdvance({ workerId: w.id, date: today, amountDzd: Number(aAmt), note: aNote || undefined }),
                      r => `${isAr ? 'سُجلت سلفة ' : 'Avance '}${formatDZD((r as { advance: { amountCt: number } }).advance.amountCt / 100, false)} — ${(r as { expense: { tillPosted: boolean } }).expense.tillPosted ? (isAr ? 'من الصندوق ✓' : 'caisse ✓') : (isAr ? 'خارج الصندوق' : 'hors-caisse')}`,
                    )} className={`${btn} bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap`}>
                      {isAr ? 'سلفة' : 'Avance'}
                    </button>
                  </div>
                  <div className="flex gap-1">
                    <input className={`${input} font-mono`} dir="ltr" type="month" value={pWorker === String(w.id) ? pMonth : today.slice(0, 7)}
                      onChange={e => { setPWorker(String(w.id)); setPMonth(e.target.value); }} />
                    <button disabled={settlePay === false || busy} title={settlePay ? undefined : (isAr ? 'للمدير فما فوق' : 'Manager+')}
                      onClick={() => void run(
                        () => settleSalary({ workerId: w.id, month: pMonth }),
                        r => { const s = r as { netPaidCt: number; carryCt: number }; return `${isAr ? 'تسوية: صافي ' : 'Paie: net '}${formatDZD(s.netPaidCt / 100, false)}${s.carryCt > 0 ? ` + ${isAr ? 'مرحّل ' : 'report '}${formatDZD(s.carryCt / 100, false)}` : ''}`; },
                      )} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white whitespace-nowrap`}>
                      {isAr ? 'تسوية الراتب' : 'Payer'}
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-500 self-center">
                    {isAr ? 'سلف الشهر: ' : 'Avances du mois: '}
                    <strong className="font-mono text-slate-300" dir="ltr">{formatDZD(monthAdvances(w.id, pWorker === String(w.id) ? pMonth : today.slice(0, 7)) / 100, false)}</strong>
                    {manageWorkers && (
                      <button onClick={() => deactivateWorker(w.id)} className="ms-3 text-rose-400 hover:text-rose-300 underline cursor-pointer">
                        {isAr ? 'تعطيل' : 'Désactiver'}
                      </button>
                    )}
                  </div>
                </div>
                {salarySettlements.filter(s => s.workerId === w.id).length > 0 && (
                  <div className="mt-2 text-[11px] text-slate-500">
                    {salarySettlements.filter(s => s.workerId === w.id).map(s => (
                      <span key={s.id} className="me-3 font-mono" dir="ltr">
                        {s.month}: net {formatDZD(s.netPaidCt / 100, false)}{s.carryCt > 0 ? ` (+${formatDZD(s.carryCt / 100, false)})` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {workers.filter(w => w.active).length === 0 && (
              <div className="text-[11px] text-slate-500 py-3 text-center">{isAr ? 'لا عمال مسجلين' : 'Aucun employé'}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
