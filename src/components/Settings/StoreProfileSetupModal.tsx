import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Store } from 'lucide-react';

/**
 * Gate-03 TASK 4 — first-run store identity provisioning.
 * Shown once on a fresh install (no setup flag in storage). The entered
 * identity locks into SQLite/localStorage and the modal never returns.
 */
export const StoreProfileSetupModal: React.FC = () => {
  const { completeStoreSetup, language } = useApp();
  const isAr = language === 'ar';
  const [form, setForm] = useState({
    store_name: '',
    rc_number: '',
    nif_number: '',
    nis_number: '',
    ai_number: '',
    address: '',
    phone: '',
  });
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.store_name.trim() || !form.nif_number.trim() || !form.rc_number.trim()) {
      setError(isAr ? 'اسم المحل + NIF + RC إجبارية' : 'Nom, NIF et RC obligatoires');
      return;
    }
    completeStoreSetup(form);
  };

  const field = (k: keyof typeof form, label: string, mono = false, placeholder = '') => (
    <div>
      <label className="text-[11px] font-semibold text-slate-300 block mb-1">{label}</label>
      <input
        value={form[k]}
        onChange={set(k)}
        placeholder={placeholder}
        className={`w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit} className="bg-[#0b0f17] border border-emerald-500/40 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-[#1e293b] flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-700 flex items-center justify-center">
            <Store className="w-5 h-5 text-emerald-400" />
          </span>
          <div>
            <div className="text-sm font-black text-white">{isAr ? 'إعداد المحل — التشغيل الأول' : 'Premier lancement — Identité du magasin'}</div>
            <div className="text-[11px] text-slate-400">{isAr ? 'تُحفظ مرة واحدة ولا تُطلب مجدداً' : 'Enregistré une seule fois, jamais redemandé'}</div>
          </div>
        </div>
        <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {field('store_name', isAr ? 'اسم المحل *' : 'Nom de l\'établissement *', false, 'Epicerie Nour')}
          <div className="grid grid-cols-2 gap-3">
            {field('nif_number', 'NIF *', true, '15 chiffres')}
            {field('rc_number', 'RC *', true)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('nis_number', 'NIS', true)}
            {field('ai_number', 'AI', true)}
          </div>
          {field('address', isAr ? 'العنوان' : 'Adresse')}
          {field('phone', isAr ? 'الهاتف' : 'Téléphone', true)}
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
        </div>
        <div className="p-4 border-t border-[#1e293b]">
          <button type="submit" className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold cursor-pointer">
            {isAr ? 'حفظ وبدء البيع (Enter)' : 'Enregistrer et ouvrir la caisse (Enter)'}
          </button>
        </div>
      </form>
    </div>
  );
};
