import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { auditSessionEvent } from '../../core/session-authority';
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
  const { storeProfile, updateStoreProfile, language, sales, session } = useApp();
  const isAr = language === 'ar';
  const isOwner = session?.role === 'owner';

  // B5: NIF locks after the first recorded sale — a tax ID must not drift
  // silently once invoices exist. Owner-only override, always audited.
  const soldOnce = sales.length > 0;
  const [nifUnlocked, setNifUnlocked] = useState(false);
  const nifLocked = soldOnce && !nifUnlocked;

  const mask = (nif: string) => nif.length > 6 ? `${nif.slice(0, 3)}***${nif.slice(-3)}` : '***';

  const unlockNif = async () => {
    if (!isOwner || !session) return;
    const ok = window.confirm(isAr
      ? 'فتح تعديل NIF رغم وجود فواتير؟ سيُسجَّل هذا في سجل التدقيق.'
      : 'Déverrouiller le NIF malgré des factures existantes ? Sera audité.');
    if (!ok) return;
    await auditSessionEvent(session.username, 'profile.change', 'nif unlock override by owner');
    setNifUnlocked(true);
  };

  const [form, setForm] = useState<StoreProfile>({
    ...storeProfile,
    // Legacy profiles predate the toggles — absent means the tax applies.
    tva_enabled: storeProfile.tva_enabled !== false,
    timbre_enabled: storeProfile.timbre_enabled !== false,
  });
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
    // B5: any NIF change after sales exist is a fiscal event — audit it (masked).
    if (soldOnce && cleanNif !== storeProfile.nif_number.replace(/\s+/g, '') && session) {
      void auditSessionEvent(session.username, 'profile.change',
        `nif ${mask(storeProfile.nif_number)} → ${mask(cleanNif)}`);
    }
    // Fiscal regime flips are legal events too — audit ON/OFF explicitly.
    // They apply to NEW sales only (each recorded sale keeps its own flags).
    if (session) {
      const wasTva = storeProfile.tva_enabled !== false, nowTva = form.tva_enabled !== false;
      if (wasTva !== nowTva) {
        void auditSessionEvent(session.username, 'profile.change',
          `régime TVA ${wasTva ? 'ON' : 'OFF'} → ${nowTva ? 'ON' : 'OFF'} (ventes futures uniquement)`);
      }
      const wasTimbre = storeProfile.timbre_enabled !== false, nowTimbre = form.timbre_enabled !== false;
      if (wasTimbre !== nowTimbre) {
        void auditSessionEvent(session.username, 'profile.change',
          `régime timbre ${wasTimbre ? 'ON' : 'OFF'} → ${nowTimbre ? 'ON' : 'OFF'} (encaissements futurs uniquement)`);
      }
    }
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
                  readOnly={nifLocked}
                  onChange={e => setForm({ ...form, nif_number: e.target.value })}
                  className={`w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-amber-300 font-mono font-bold outline-none focus:border-amber-500 ${nifLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Ex: 001516012345678 (15 chiffres)
                </span>
                {/* B5: lock notice + owner-only override */}
                {nifLocked && (
                  <div className="mt-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200 flex items-center gap-2 flex-wrap">
                    <span>{isAr ? 'مقفَل: توجد فواتير مسجلة بهذا NIF.' : 'Verrouillé : des factures existent avec ce NIF.'}</span>
                    {isOwner && (
                      <button type="button" onClick={() => void unlockNif()} className="underline font-bold hover:text-amber-100 cursor-pointer">
                        {isAr ? 'فتح (مالك، يُسجَّل)' : 'Déverrouiller (gérant, audité)'}
                      </button>
                    )}
                  </div>
                )}
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

            {/* Fiscal regime toggles (owner): forfait/exemptions per shop need. */}
            <div className="bg-[#0b0f17] border border-amber-900/50 rounded-xl p-3 space-y-3">
              <div className="text-[11px] font-bold text-amber-300">
                {isAr ? 'النظام الجبائي للبيع (يطبق على المبيعات الجديدة فقط — كل فاتورة تحتفظ بنظامها)' : 'Régime fiscal des ventes (ventes futures uniquement — chaque facture garde son régime)'}
              </div>
              {([
                { key: 'tva_enabled' as const,
                  title: isAr ? 'TVA مطبقة على المبيعات (0 / 9 / 19%)' : 'TVA appliquée aux ventes (0 / 9 / 19 %)',
                  offHint: isAr ? 'متوقف: نظام جزافي — كل الأسطر TVA 0 (HT = TTC)' : 'OFF : régime forfaitaire — toutes les lignes en TVA 0 (HT = TTC)' },
                { key: 'timbre_enabled' as const,
                  title: isAr ? 'حق الطابع على الدفع نقداً (المادة 136)' : 'Droit de timbre sur espèces (Art. 136)',
                  offHint: isAr ? 'متوقف: لا طابع مهما كانت طريقة الدفع' : 'OFF : aucun timbre quelle que soit la méthode' },
              ]).map(sw => {
                const on = form[sw.key] !== false;
                return (
                  <div key={sw.key} className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-200">{sw.title}</div>
                      {!on && <div className="text-[10px] text-amber-400/80 mt-0.5">{sw.offHint}</div>}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={() => setForm({ ...form, [sw.key]: !on })}
                      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${on ? 'bg-emerald-600' : 'bg-slate-700'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? (isAr ? 'left-0.5' : 'left-[22px]') : (isAr ? 'left-[22px]' : 'left-0.5')}`} />
                    </button>
                  </div>
                );
              })}
              <div className="text-[10px] text-slate-500">
                {isAr
                  ? 'تنبيه: أي تغيير يُسجَّل في التدقيق مع اسم المستخدم. الفواتير السابقة لا تتأثر.'
                  : 'Tout changement est audité (utilisateur horodaté). Les factures existantes sont intangibles.'}
              </div>
            </div>

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
