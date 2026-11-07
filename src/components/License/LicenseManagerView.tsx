import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  computeHwid, collectBrowserFingerprint,
  validateLicense, evaluateTrial,
} from '../../core/licensing';
import { getOrCreateMachineSeed, getInstallEpochMs, loadStoredLicense, saveStoredLicense } from '../../core/license-store';
import { APP_VERSION } from '../../core/version';
import {
  KeyRound,
  ShieldCheck,
  Copy,
  Check,
  Building2,
  WifiOff,
  FileCheck2,
  Store,
  Fingerprint,
  KeySquare,
  Headset,
} from 'lucide-react';

/* PLAN-v1.5.1-UX §1 — institutional Licence page.
 * BarakaDEV identity first, activation sanctuary second, licence terms third.
 * No price is ever rendered here: pricing lives on the quote/invoice, not in
 * the product. Key generation stays EXCLUSIVELY in scripts/keygen.ts. */

export const LicenseManagerView: React.FC = () => {
  const { language, sales, storeProfile, licenseBroken, licenseDrift, licenseCryptoOk } = useApp();
  const isAr = language === 'ar';

  // Gate-03 TASK 3: real deterministic HWID (stable seed + platform fingerprint).
  const seed = useMemo(() => getOrCreateMachineSeed(), []);
  const hardwareId = useMemo(() => computeHwid(collectBrowserFingerprint(seed)), [seed]);
  const [storeName, setStoreName] = useState(() => loadStoredLicense()?.storeName ?? storeProfile.store_name ?? '');
  const [inputKey, setInputKey] = useState('');
  const [stored, setStored] = useState(() => loadStoredLicense());
  const [activationError, setActivationError] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);

  // L8-fix: the stored record can change behind our back (SQLite-mirror
  // restore, another tab) — re-read on focus and on storage events.
  useEffect(() => {
    const reread = () => setStored(loadStoredLicense());
    window.addEventListener('focus', reread);
    window.addEventListener('storage', reread);
    return () => {
      window.removeEventListener('focus', reread);
      window.removeEventListener('storage', reread);
    };
  }, []);

  // Key generation lives EXCLUSIVELY in scripts/keygen.ts (BarakaDEV staff CLI).
  // Nothing vendor-side is imported, rendered, or bundled in this client view.

  const trial = evaluateTrial(
    stored?.status ?? 'TRIAL',
    sales.filter(s => s.status === 'COMPLETED').length,
    getInstallEpochMs(),
    Date.now(),
  );
  const isActivated = stored?.status === 'ACTIVATED';
  // L1-fix: a cryptographically rejected key is never displayed as active.
  const showActive = isActivated && !licenseBroken;

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
      {/* ── 1 · Institutional hero — BarakaDEV first, never a price ── */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[#111722] via-[#162030] to-[#111722] border border-[#1e293b] rounded-2xl p-6 md:p-8 shadow-2xl">
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
              BarakaDEV — Algerian Retail Solutions
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
              Baraka Market v{APP_VERSION}
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">
            {isAr ? 'الترخيص والدعم المؤسسي' : 'Licence & support institutionnel'}
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed max-w-2xl">
            {isAr
              ? 'محرّك البيع بالتجزئة من تطوير BarakaDEV — يعمل دون إنترنت، مرتبط ببصمة جهازك، ومدعوم بعقد صيانة مؤسسي.'
              : 'Moteur retail développé par BarakaDEV — 100% hors-ligne, lié à votre machine, couvert par un support institutionnel.'}
          </p>
        </div>

        <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 justify-self-center md:justify-self-end whitespace-nowrap ${showActive ? 'bg-emerald-950/60 border-emerald-800/60' : 'bg-amber-950/60 border-amber-800/60'}`}>
          <ShieldCheck className={`w-8 h-8 ${showActive ? 'text-emerald-400' : 'text-amber-400'}`} />
          <div>
            <div className="text-xs font-bold text-white">
              {showActive
                ? (isAr ? 'الترخيص نشط ومفعل مدى الحياة' : 'Licence Activée (À Vie)')
                : (isAr ? `نسخة تجريبية — ${trial.salesRemaining} عملية / ${trial.daysRemaining} يوم` : `Essai — ${trial.salesRemaining} ventes / ${trial.daysRemaining} j`)}
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {showActive ? stored?.storeName : 'TRIAL 50 ventes / 14 j'} • {hardwareId}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* ── 2 · Who stands behind the product ────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: Building2, t: isAr ? 'مطوّر جزائري' : 'Éditeur algérien', d: isAr ? 'تصميم وتطوير وصيانة محلية — فواتير بالدينار وعقود صيانة للمؤسسات.' : 'Conception locale — facturation en DZD, contrats de maintenance pour les enseignes.' },
          { icon: WifiOff, t: isAr ? 'استقلالية تامة' : 'Autonomie totale', d: isAr ? 'تفعيل وتشغيل دون إنترنت — لا اشتراكات، لا اعتماد على السحابة.' : 'Activation et exploitation sans internet — ni abonnement, ni dépendance cloud.' },
          { icon: FileCheck2, t: isAr ? 'امتثال محاسبي' : 'Conformité SCF', d: isAr ? 'يومية جبائية وسلاسل أرقام قابلة للتدقيق وفق النظام المحاسبي.' : 'Journal fiscal et chaînage vérifiable, alignés sur le SCF.' },
        ].map(c => (
          <div key={c.t} className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 flex gap-3.5">
            <c.icon className="w-7 h-7 shrink-0 text-amber-400" />
            <div>
              <div className="text-sm font-black text-white mb-1">{c.t}</div>
              <div className="text-xs text-slate-400 leading-relaxed">{c.d}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── 3 + 4 · Activation sanctuary + licence terms ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">
        <div className="bg-[#111722] border border-amber-500/25 rounded-2xl shadow-2xl overflow-hidden">
          <div className="text-center px-6 pt-6 pb-4 border-b border-[#1e293b] relative">
            <div aria-hidden={true} className="pointer-events-none absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent" />
            <div className="text-base md:text-lg font-black tracking-wide text-white">
              BARAKA MARKET — {isAr ? 'تفعيل النظام' : 'ACTIVATION DU SYSTÈME'}
            </div>
            <div className="text-[11px] text-amber-300/90 mt-0.5">ETS MOHAMED EL-BARAKA / BarakaDEV</div>
          </div>

          <div className="p-6 space-y-5">
            {/* L1 + drift-lock: forged key → invalid; genuine key on another
                machine (crypto OK, hwid drifted) → re-activate here. Legacy
                no-hwid drift keeps the amber warning below (never a lock). */}
            {licenseBroken && (
              <div className="flex items-center gap-3 rounded-xl border px-4 py-3 bg-rose-950/60 border-rose-800/60">
                <ShieldCheck className="w-7 h-7 shrink-0 text-rose-400" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-rose-300">
                    {isAr ? (!licenseCryptoOk ? 'مفتاح مرفوض' : 'جهاز مختلف') : (!licenseCryptoOk ? 'Clé rejetée' : 'Autre appareil')}
                  </div>
                  <div className="text-sm font-black text-white">
                    {isAr
                      ? (!licenseCryptoOk ? '● هذا المفتاح غير صالح — أعد إدخال مفتاح BarakaDEV الصحيح' : '● هذا المفتاح مفعّل على جهاز آخر — أعد التفعيل على هذا الصندوق')
                      : (!licenseCryptoOk ? '● Clé invalide — ressaisissez la clé BarakaDEV authentique' : '● Clé activée sur un autre appareil — réactivez sur cette caisse')}
                  </div>
                </div>
              </div>
            )}
            {/* Drift without lock = legacy record with no activation HWID
                (grandfathered, warning only). Known-hwid drift locks above. */}
            {licenseDrift && !licenseBroken && isActivated && (
              <div className="flex items-center gap-3 rounded-xl border px-4 py-3 bg-amber-950/40 border-amber-800/50">
                <ShieldCheck className="w-7 h-7 shrink-0 text-amber-400" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                    {isAr ? 'تنبيه جهاز' : 'Appareil différent'}
                  </div>
                  <div className="text-sm font-black text-white">
                    {isAr ? '● بصمة هذا الجهاز تختلف عن بصمة التفعيل — المفتاح سليم، أعد التفعيل عند تغيير الصندوق' : '● HWID différent de l’activation — clé valide, réactivez en cas de changement de caisse'}
                  </div>
                </div>
              </div>
            )}
            {/* System status */}
            <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${showActive ? 'bg-emerald-950/60 border-emerald-800/60' : 'bg-amber-950/40 border-amber-800/50'}`}>
              <ShieldCheck className={`w-7 h-7 shrink-0 ${showActive ? 'text-emerald-400' : 'text-amber-400'}`} />
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {isAr ? 'حالة النظام' : 'État du système'}
                </div>
                <div className="text-sm font-black text-white">
                  {showActive
                    ? (isAr ? '● رخصة دائمة مدى الحياة' : '● LICENCE PERPÉTUELLE À VIE')
                    : (isAr
                      ? `● نسخة تجريبية — متبقي ${trial.salesRemaining} عملية بيع / ${trial.daysRemaining} يوم`
                      : `● Version d'essai — ${trial.salesRemaining} ventes / ${trial.daysRemaining} j restants`)}
                </div>
              </div>
            </div>

            {/* Step 1 — HWID */}
            <div>
              <div className="text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
                <Fingerprint className="w-3.5 h-3.5 text-amber-400" />
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

            {/* Steps 2+3 — store identity + activation key */}
            <form onSubmit={handleActivate} className="space-y-3">
              <div>
                <div className="text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-amber-400" />
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
                <div className="text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
                  <KeySquare className="w-3.5 h-3.5 text-amber-400" />
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
              {showActive && (
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
            {isAr ? 'الأمان: توقيع Ed25519 دون اتصال | لا يتطلب اتصالاً بالإنترنت' : 'Sécurité: signature Ed25519 hors-ligne | Aucune connexion Internet requise'}
          </div>
        </div>

        {/* ── 4 · Licence terms + support channel ─────────────────────── */}
        <div className="space-y-4">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5">
            <div className="text-sm font-black text-white mb-3">
              {isAr ? 'شروط الرخصة الدائمة' : 'Conditions de la licence perpétuelle'}
            </div>
            <ul className="space-y-2 text-xs text-slate-300 leading-relaxed">
              {(isAr
                ? ['دفعة واحدة مدى الحياة — بلا اشتراكات ولا رسوم متكررة', 'مرتبطة بهذا الجهاز (HWID) — قابلة للنقل عبر الدعم عند تغيير الصندوق', 'تفعيل وتشغيل كامل دون إنترنت', 'التحديثات والدعم عبر قناة BarakaDEV الرسمية']
                : ['Paiement unique à vie — ni abonnement, ni frais récurrents', 'Liée à cette machine (HWID) — transférable via le support en cas de changement de caisse', 'Activation et exploitation 100% hors-ligne', 'Mises à jour et support via le canal officiel BarakaDEV']
              ).map(li => (
                <li key={li} className="flex gap-2">
                  <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400 mt-0.5" />
                  <span>{li}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/25 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-sm font-black text-white mb-2">
              <Headset className="w-4 h-4 text-amber-400" />
              {isAr ? 'الحصول على المفتاح' : 'Obtenir votre clé'}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-2">
              {isAr
                ? 'أرسل بصمة الجهاز (HWID) مع اسم المحل إلى موزّعك المعتمد أو إلى الدعم الفني لـ BarakaDEV:'
                : 'Envoyez votre HWID avec le nom du magasin à votre revendeur agréé ou au support BarakaDEV :'}
            </p>
            <p className="font-mono text-white text-sm">📞 Téléphone / WhatsApp: +213 770 80 70 05</p>
            <p className="text-[11px] text-slate-500 mt-2">
              {isAr ? 'الأسعار وشروط البيع في عرض السعر والفاتورة — لا تُعرض داخل البرنامج.' : 'Tarifs et CGV sur devis et facture — jamais affichés dans le produit.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
