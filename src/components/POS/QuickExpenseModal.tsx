import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { ExpenseCategory } from '../../types';

const CATS: { v: ExpenseCategory; ar: string; fr: string }[] = [
  { v: 'LOYER', ar: 'كراء المحل', fr: 'Loyer' },
  { v: 'ELEC_EAU', ar: 'كهرباء وماء', fr: 'Électricité / Eau' },
  { v: 'TRANSPORT', ar: 'نقل', fr: 'Transport' },
  { v: 'MAINTENANCE', ar: 'صيانة', fr: 'Maintenance' },
  { v: 'TELECOM', ar: 'هاتف وأنترنت', fr: 'Télécom' },
  { v: 'AUTRE', ar: 'مصروف آخر', fr: 'Autre' },
];

/** P2 (v1.4.4): cashier-speed expense ticket — amount + category, posts to the till. */
export const QuickExpenseModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { recordExpense, language } = useApp();
  const isAr = language === 'ar';
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('LOYER');
  const [method, setMethod] = useState<'ESPECES' | 'VIREMENT' | 'CHEQUE'>('ESPECES');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMsg('');
    try {
      const exp = await recordExpense({ date: today, category, amountDzd: Number(amount), method, note: note || undefined });
      setMsg(`${isAr ? 'سُجل' : 'Enregistré'} ${exp.id} — ${exp.tillPosted ? (isAr ? 'خرج من الصندوق ✓' : 'till ✓') : (isAr ? 'خارج الصندوق' : 'hors-caisse')}`);
      setAmount('');
      setNote('');
    } catch (e) {
      setMsg(`${isAr ? 'خطأ: ' : 'Erreur: '}${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full bg-[#111722] border border-[#2b3a4f] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#0d1420] border border-[#2b3a4f] rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white">{isAr ? 'مصروف صندوق (يخرج من النقدية)' : 'Dépense de caisse'}</h3>
        <div>
          <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الفئة' : 'Catégorie'}</label>
          <select className={input} value={category} onChange={e => setCategory(e.target.value as ExpenseCategory)}>
            {CATS.map(c => <option key={c.v} value={c.v}>{isAr ? c.ar : c.fr}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'المبلغ (دج)' : 'Montant (DZD)'}</label>
            <input className={`${input} font-mono`} dir="ltr" type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الطريقة' : 'Moyen'}</label>
            <select className={input} value={method} onChange={e => setMethod(e.target.value as typeof method)}>
              <option value="ESPECES">{isAr ? 'نقداً' : 'Espèces'}</option>
              <option value="VIREMENT">{isAr ? 'تحويل' : 'Virement'}</option>
              <option value="CHEQUE">{isAr ? 'شيك' : 'Chèque'}</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'ملاحظة (اختياري)' : 'Note (optionnel)'}</label>
          <input className={input} value={note} onChange={e => setNote(e.target.value)} />
        </div>
        {msg && <div className="text-[11px] text-slate-300 bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2">{msg}</div>}
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => void submit()} className="flex-1 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer disabled:opacity-50">
            {isAr ? 'تسجيل المصروف' : 'Enregistrer'}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold bg-[#1e293b] hover:bg-[#2b3a4f] text-white cursor-pointer">
            {isAr ? 'إغلاق' : 'Fermer'}
          </button>
        </div>
      </div>
    </div>
  );
};
