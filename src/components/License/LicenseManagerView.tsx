import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  computeHwid, collectBrowserFingerprint,
  validateLicense, evaluateTrial,
} from '../../core/licensing';
import { getOrCreateMachineSeed, getInstallEpochMs, loadStoredLicense, saveStoredLicense } from '../../core/license-store';
import {
  KeyRound,
  ShieldCheck,
  Copy,
  Check,
} from 'lucide-react';

export const LicenseManagerView: React.FC = () => {
  const { language, sales, storeProfile } = useApp();
  const isAr = language === 'ar';

  // Gate-03 TASK 3: real deterministic HWID (stable seed + platform fingerprint).
  const seed = useMemo(() => getOrCreateMachineSeed(), []);
  const hardwareId = useMemo(() => computeHwid(collectBrowserFingerprint(seed)), [seed]);
  const [storeName, setStoreName] = useState(() => loadStoredLicense()?.storeName ?? storeProfile.store_name ?? '');
  const [inputKey, setInputKey] = useState('');
  const [stored, setStored] = useState(() => loadStoredLicense());
  const [activationError, setActivationError] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);

  // Key generation lives EXCLUSIVELY in scripts/keygen.ts (BarakaDEV staff CLI).
  // Nothing vendor-side is imported, rendered, or bundled in this client view.

  const trial = evaluateTrial(
    stored?.status ?? 'TRIAL',
    sales.filter(s => s.status === 'COMPLETED').length,
    getInstallEpochMs(),
    Date.now(),
  );
  const isActivated = stored?.status === 'ACTIVATED';

  const handleCopy = (text: string) => {
    try { navigator.clipboard.writeText(text); } catch { /* headless/test lane */ }
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setActivationError('');
    if (!storeName.trim()) {
      setActivationError(isAr ? 'أدخل اسم المحل أولاً' : 'Saisissez le nom du magasin');
      return;
    }
    if (await validateLicense(storeName, hardwareId, inputKey)) {
      // ADR-002: persist HWID with the record — SQLite restore refuses mismatches.
      const rec = { status: 'ACTIVATED' as const, storeName: storeName.trim(), key: inputKey.trim(), hwid: hardwareId, installedAtMs: getInstallEpochMs() };
      saveStoredLicense(rec); // localStorage + fire-and-forget SQLite meta mirror
      setStored(rec);
    } else {
      setActivationError(isAr ? 'مفتاح غير صالح لهذا المحل/الجهاز' : 'Clé invalide pour ce magasin / HWID');
    }
  };

  return (
    <div className="flex-1 bg-[#0b0f17] p-6 overflow-y-auto space-y-6">
      {/* Header Banner */}
      <div className="force-dark relative overflow-hidden bg-gradient-to-r from-[#111722] via-[#162030] to-[#111722] border border-[#1e293b] rounded-2xl p-6 md:p-8 shadow-2xl">
        {/* Gold hairline sheen */}
        <div aria-hidden={true} className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent" />
        {/* Watermark depth layer */}
        <img
          src="/brand/baraka-emblem-512.png"
          aria-hidden={true}
          className="pointer-events-none absolute -end-16 -bottom-28 w-96 h-96 object-contain opacity-10 select-none"
          draggable={false}
        />
        <div className="relative grid grid-cols-1 md:grid-cols-[auto_1fr_auto] items-center gap-6 md:gap-8">
        {/* Floating emblem — no box, no ring: gold lives on the gradient */}
        <img
          src="/brand/baraka-emblem-512.png"
          alt="Baraka — بركة"
          className="w-40 h-40 md:w-44 md:h-44 object-contain justify-self-center drop-shadow-[0_0_44px_rgba(212,175,55,0.6)]"
          draggable={false}
        />
        <div className="space-y-2.5 text-center md:text-start">
          <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              BarakaDEV Algerian Retail Solutions
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Tarif Unique: 5,000 DZD
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">
            {isAr ? 'نظام الحماية ورخصة البرنامج بدون إنترنت (Offline Licensing)' : 'Licence Perpétuelle & Empreinte Matérielle'}
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed max-w-2xl">
            {isAr
              ? 'تعتمد منظومة Baraka Market على بصمة العتاد (Hardware ID) لتفعيل النسخة الدائمة بدون الحاجة لاتصال بالإنترنت، مع ثبات مطلق وسرعة تشغيل فائقة.'
              : 'Système d\'activation autonome hors-ligne basé sur l\'empreinte unique de la machine (HWID), sans dépendance au cloud ni frais récurrents.'}
          </p>
        </div>

        <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 justify-self-center md:justify-self-end whitespace-nowrap ${isActivated ? 'bg-emerald-950/60 border-emerald-800/60' : 'bg-amber-950/60 border-amber-800/60'}`}>
          <ShieldCheck className={`w-8 h-8 ${isActivated ? 'text-emerald-400' : 'text-amber-400'}`} />
          <div>
            <div className="text-xs font-bold text-white">
              {isActivated
                ? (isAr ? 'الترخيص نشط ومفعل مدى الحياة' : 'Licence Activée (À Vie)')
                : (isAr ? `نسخة تجريبية — ${trial.salesRemaining} عملية / ${trial.daysRemaining} يوم` : `Essai — ${trial.salesRemaining} ventes / ${trial.daysRemaining} j`)}
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {isActivated ? stored?.storeName : 'TRIAL 50 ventes / 14 j'} • {hardwareId}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Luxe épuré activation sanctuary — single centered card, zero vendor tools. */}
      <div className="flex justify-center">
        <div className="w-full max-w-2xl bg-[#111722] border border-amber-500/25 rounded-2xl shadow-2xl overflow-hidden">
          <div className="text-center px-6 pt-6 pb-4 border-b border-[#1e293b] relative">
            <div aria-hidden={true} className="pointer-events-none absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent" />
            <div className="text-base md:text-lg font-black tracking-wide text-white">
              BARAKA MARKET — {isAr ? 'تفعيل النظام' : 'ACTIVATION DU SYSTÈME'}
            </div>
            <div className="text-[11px] text-amber-300/90 mt-0.5">ETS MOHAMED EL-BARAKA / BarakaDEV</div>
          </div>

          <div className="p-6 space-y-5">
            {/* System status */}
            <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${isActivated ? 'bg-emerald-950/60 border-emerald-800/60' : 'bg-amber-950/40 border-amber-800/50'}`}>
              <ShieldCheck className={`w-7 h-7 shrink-0 ${isActivated ? 'text-emerald-400' : 'text-amber-400'}`} />
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {isAr ? 'حالة النظام' : 'État du système'}
                </div>
                <div className="text-sm font-black text-white">
                  {isActivated
                    ? (isAr ? '● رخصة دائمة مدى الحياة' : '● LICENCE PERPÉTUELLE À VIE')
                    : (isAr
                      ? `● نسخة تجريبية — متبقي ${trial.salesRemaining} عملية بيع / ${trial.daysRemaining} يوم`
                      : `● Version d'essai — ${trial.salesRemaining} ventes / ${trial.daysRemaining} j restants`)}
                </div>
              </div>
            </div>

            {/* Step 1 — HWID */}
            <div>
              <div className="text-xs font-bold text-white mb-1.5">
                {isAr ? '1. البصمة الفريدة لصندوقك (HWID):' : '1. EMPREINTE UNIQUE DE VOTRE CAISSE (HWID) :'}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={hardwareId}
                  className="flex-1 bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2.5 text-sm text-amber-300 font-mono font-bold outline-none"
                />
                <button
                  onClick={() => handleCopy(hardwareId)}
                  className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isAr ? 'نسخ' : 'COPIER'}</span>
                </button>
              </div>
            </div>

            {/* Activation instructions */}
            <div className="bg-[#0b0f17] border border-[#233145] rounded-xl p-3.5 text-xs text-slate-300 leading-relaxed space-y-1">
              <div className="font-bold text-amber-300 text-[11px] uppercase tracking-wide">
                {isAr ? 'إرشادات التفعيل السريع' : "Instructions d'activation rapide"}
              </div>
              <p>
                {isAr
                  ? 'للحصول على مفتاح التفعيل الدائم، يرجى إرسال هذا الكود (HWID) مع اسم المحل عبر واتساب أو الهاتف إلى مصلحة الدعم الفني لشركة BarakaDEV:'
                  : 'Pour obtenir la clé définitive, envoyez ce code (HWID) avec le nom du magasin via WhatsApp ou téléphone au support BarakaDEV:'}
              </p>
              <p className="font-mono text-white">📞 Téléphone / WhatsApp: +213 (0) XX XX XX XX</p>
              <p>💰 {isAr ? 'سعر الرخصة: 5,000 دج (دفعة واحدة مدى الحياة)' : 'Tarif de la licence: 5,000 DZD (Paiement unique à vie)'}</p>
            </div>

            {/* Steps 2+3 — store identity + activation key */}
            <form onSubmit={handleActivate} className="space-y-3">
              <div>
                <div className="text-xs font-bold text-white mb-1.5">
                  {isAr ? '2. اسم المحل (كما في السجل التجاري):' : '2. NOM DU MAGASIN (registre de commerce):'}
                </div>
                <input
                  type="text"
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder={isAr ? 'مثال: عطارة النور' : 'Ex: Epicerie Nour'}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-white mb-1.5">
                  {isAr ? '3. أدخل مفتاح التفعيل المستلم:' : "3. SAISIR LA CLÉ D'ACTIVATION REÇUE:"}
                </div>
                <input
                  type="text"
                  value={inputKey}
                  onChange={e => setInputKey(e.target.value.trim())}
                  placeholder="AK-…" maxLength={92}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2.5 text-sm text-emerald-400 font-mono font-bold outline-none focus:border-emerald-500"
                />
              </div>
              {activationError && <p className="text-[11px] text-rose-400">{activationError}</p>}
              {isActivated && (
                <p className="text-[11px] text-emerald-400 font-mono">{stored?.key}</p>
              )}
              <button
                type="submit"
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl text-sm font-black shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 cursor-pointer"
              >
                <KeyRound className="w-4 h-4" />
                <span>{isAr ? 'تفعيل النظام نهائياً' : 'ACTIVER DÉFINITIVEMENT LE SYSTÈME'}</span>
              </button>
            </form>
          </div>

          <div className="px-6 py-3 border-t border-[#1e293b] text-center text-[10px] text-slate-500">
            {isAr ? 'الأمان: تشفير محلي SHA-256 | لا يتطلب اتصالاً بالإنترنت' : 'Sécurité: Chiffrement Local SHA-256 | Aucune connexion Internet requise'}
          </div>
        </div>
      </div>
    </div>
  );
};
