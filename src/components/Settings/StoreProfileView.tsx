import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { StoreProfile } from '../../types';
import {
  Settings,
  Building,
  FileCheck,
  Percent,
  CheckCircle,
  Save,
  AlertCircle,
} from 'lucide-react';

export const StoreProfileView: React.FC = () => {
  const { storeProfile, updateStoreProfile, language } = useApp();
  const isAr = language === 'ar';

  const [form, setForm] = useState<StoreProfile>({ ...storeProfile });
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [nifError, setNifError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate NIF (15 digits in Algeria)
    const cleanNif = form.nif_number.replace(/\s+/g, '');
    if (cleanNif.length !== 15 || !/^\d+$/.test(cleanNif)) {
      setNifError(
        isAr
          ? 'تنبيه قانوني: رقم التعريف الجبائي (NIF) في الجزائر يجب أن يتكون من 15 رقماً بالضبط.'
          : 'Le NIF algérien doit comporter exactement 15 chiffres.'
      );
      return;
    }

    setNifError(null);
    updateStoreProfile(form);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="flex-1 bg-[#0b0f17] p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Title */}
        <div className="flex items-center justify-between border-b border-[#1e293b] pb-4">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-emerald-400" />
              <span>{isAr ? 'الإعدادات الجبائية والقانونية للسوبرماركت' : 'Profil & Paramètres Fiscaux DGI'}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isAr
                ? 'البيانات الإلزامية الصادرة عن المديرية العامة للضرائب (DGI) ووزارة التجارة الجزائرية'
                : 'Mentions légales obligatoires figurant sur les tickets et factures réglementaires'}
            </p>
          </div>

          {savedSuccess && (
            <div className="px-3 py-1.5 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 animate-in fade-in">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>{isAr ? 'تم حفظ التعديلات بنجاح' : 'Modifications enregistrées'}</span>
            </div>
          )}
        </div>

        {nifError && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{nifError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Card 1: Mentions Légales Obligatoires (NIF, NIS, RC, AI) */}
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2 border-b border-[#1e293b] pb-2">
              <FileCheck className="w-4 h-4" />
              <span>{isAr ? '1. المعرفات الجبائية والتجارية الرسمية' : 'Identifiants Fiscaux & Commerciaux Obligatoires'}</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  NIF - Numéro d&apos;Identification Fiscale (15 chiffres): *
                </label>
                <input
                  type="text"
                  required
                  maxLength={15}
                  value={form.nif_number}
                  onChange={e => setForm({ ...form, nif_number: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-amber-300 font-mono font-bold outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Ex: 001516012345678 (15 chiffres)
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  NIS - Numéro d&apos;Immatriculation Statistique: *
                </label>
                <input
                  type="text"
                  required
                  value={form.nis_number}
                  onChange={e => setForm({ ...form, nis_number: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Ex: 198501010099</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  R.C - Registre de Commerce (avec Code Activité 501101): *
                </label>
                <input
                  type="text"
                  required
                  value={form.rc_number}
                  onChange={e => setForm({ ...form, rc_number: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Ex: 16/00-501101</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  A.I - Article d&apos;Imposition: *
                </label>
                <input
                  type="text"
                  required
                  value={form.ai_number}
                  onChange={e => setForm({ ...form, ai_number: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Ex: 16010023451</span>
              </div>
            </div>
          </div>

          {/* Card 2: Store Identity & Coordinates */}
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2 border-b border-[#1e293b] pb-2">
              <Building className="w-4 h-4" />
              <span>{isAr ? '2. هوية المحل والاسم التجاري والعنوان' : 'Enseigne Commerciale & Coordonnées'}</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'اسم المحل / السوبرماركت:' : 'Nom de l\'Enseigne:'}
                </label>
                <input
                  type="text"
                  required
                  value={form.store_name}
                  onChange={e => setForm({ ...form, store_name: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white font-bold outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'اسم الشركة المالكة / المسير:' : 'Raison Sociale / Propriétaire:'}
                </label>
                <input
                  type="text"
                  required
                  value={form.company_owner}
                  onChange={e => setForm({ ...form, company_owner: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'العنوان الجغرافي:' : 'Adresse Géographique:'}
                </label>
                <input
                  type="text"
                  required
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'الهاتف للتواصل:' : 'Numéros de Téléphone:'}
                </label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white outline-none"
                />
              </div>
            </div>
          </div>

          {/* Card 3: Tax Engine Settings & Droit de Timbre */}
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-sky-400 flex items-center gap-2 border-b border-[#1e293b] pb-2">
              <Percent className="w-4 h-4" />
              <span>{isAr ? '3. محددات حق الطابع المالي (Droit de Timbre Fiscal)' : 'Configuration Droit de Timbre (Art. 136)'}</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'نسبة الطابع على الدفع نقداً:' : 'Taux Timbre Fiscal (Espèces):'}
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={form.timbre_rate}
                  onChange={e => setForm({ ...form, timbre_rate: parseFloat(e.target.value) || 0.01 })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Défaut: 0.01 (1%)</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'الحد الأدنى للطابع (DZD):' : 'Plancher Minimum (DZD):'}
                </label>
                <input
                  type="number"
                  value={form.timbre_min}
                  onChange={e => setForm({ ...form, timbre_min: parseFloat(e.target.value) || 10 })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'الحد الأقصى للطابع (DZD):' : 'Plafond Maximum (DZD):'}
                </label>
                <input
                  type="number"
                  value={form.timbre_max}
                  onChange={e => setForm({ ...form, timbre_max: parseFloat(e.target.value) || 2500 })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                {isAr ? 'تذييل التذكرة الحرارية (Pied du Ticket):' : 'Message Bas de Ticket:'}
              </label>
              <textarea
                rows={2}
                value={form.receipt_footer}
                onChange={e => setForm({ ...form, receipt_footer: e.target.value })}
                className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl p-3 text-xs text-white outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950/40 flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isAr ? 'حفظ البيانات القانونية' : 'Enregistrer les Modifications'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
