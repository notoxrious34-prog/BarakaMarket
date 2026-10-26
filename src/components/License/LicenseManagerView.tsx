import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { computeActivationKey } from '../../utils/fiscal';
import {
  KeyRound,
  ShieldCheck,
  Cpu,
  Database,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  HardDrive,
  Zap,
} from 'lucide-react';

export const LicenseManagerView: React.FC = () => {
  const { language } = useApp();
  const isAr = language === 'ar';

  // Hardware ID for this POS machine
  const [hardwareId] = useState('BM-7F89-A2C4-99D1');
  const [activationKey, setActivationKey] = useState(() => computeActivationKey('BM-7F89-A2C4-99D1'));
  const [inputKey, setInputKey] = useState(activationKey);
  const [isActivated, setIsActivated] = useState(true);
  const [copiedKey, setCopiedKey] = useState(false);

  // Key generator simulator for BarakaDEV
  const [keygenInputHWID, setKeygenInputHWID] = useState('BM-');
  const [generatedResult, setGeneratedResult] = useState('');

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleGenerateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keygenInputHWID.trim()) return;
    const res = computeActivationKey(keygenInputHWID.trim());
    setGeneratedResult(res);
  };

  return (
    <div className="flex-1 bg-[#0b0f17] p-6 overflow-y-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#111722] via-[#162030] to-[#111722] border border-[#1e293b] rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        {/* Official Baraka (بركة) emblem — large placement */}
        <img
          src="/brand/baraka-emblem-512.png"
          alt="Baraka — بركة"
          className="w-36 h-36 rounded-3xl object-cover ring-1 ring-white/10 shadow-2xl shadow-black/50 shrink-0"
          draggable={false}
        />
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              BarakaDEV Algerian Retail Solutions
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Tarif Unique: 5,000 DZD
            </span>
          </div>
          <h2 className="text-2xl font-black text-white">
            {isAr ? 'نظام الحماية ورخصة البرنامج بدون إنترنت (Offline Licensing)' : 'Licence Perpétuelle & Empreinte Matérielle'}
          </h2>
          <p className="text-xs text-slate-400 max-w-2xl">
            {isAr
              ? 'تعتمد منظومة Baraka Market على بصمة العتاد (Hardware ID) لتفعيل النسخة الدائمة بدون الحاجة لاتصال بالإنترنت، مع ثبات مطلق وسرعة تشغيل فائقة.'
              : 'Système d\'activation autonome hors-ligne basé sur l\'empreinte unique de la machine (HWID), sans dépendance au cloud ni frais récurrents.'}
          </p>
        </div>

        <div className="flex items-center gap-3 bg-emerald-950/60 border border-emerald-800/60 rounded-xl px-4 py-3">
          <ShieldCheck className="w-8 h-8 text-emerald-400" />
          <div>
            <div className="text-xs font-bold text-white">
              {isAr ? 'الترخيص نشط ومفعل مدى الحياة' : 'Licence Activée (À Vie)'}
            </div>
            <div className="text-[11px] text-emerald-300 font-mono">
              Poste Caisse #01 • Illimité
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Machine Hardware ID & Status */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-amber-400" />
            <span>{isAr ? 'بيانات هذا الجهاز والعتاد (Poste POS)' : 'Empreinte de ce Terminal (HWID)'}</span>
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {isAr ? 'معرف بصمة الجهاز (Hardware ID):' : 'Identifiant Unique Machine (HWID):'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={hardwareId}
                  className="flex-1 bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-sm text-amber-300 font-mono font-bold outline-none"
                />
                <button
                  onClick={() => handleCopy(hardwareId)}
                  className="px-3 py-2 bg-[#162030] hover:bg-[#233145] text-slate-300 rounded-xl text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{isAr ? 'نسخ' : 'Copier'}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {isAr ? 'مفتاح التفعيل (Offline Activation Key):' : 'Clé d\'Activation Active:'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={activationKey}
                  className="flex-1 bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-sm text-emerald-400 font-mono font-bold outline-none"
                />
                <button
                  onClick={() => handleCopy(activationKey)}
                  className="px-3 py-2 bg-[#162030] hover:bg-[#233145] text-slate-300 rounded-xl text-xs flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey ? (isAr ? 'تم' : 'Copié') : (isAr ? 'نسخ' : 'Copier')}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#1e293b] space-y-2 text-xs text-slate-400">
            <div className="flex items-center justify-between">
              <span>{isAr ? 'نموذج التسعير الاستراتيجي:' : 'Modèle Économique:'}</span>
              <span className="font-bold text-white">5,000 DZD {isAr ? '(دفعة واحدة دائمة)' : '(Paiement unique)'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{isAr ? 'حجم حزمة التثبيت الصامتة:' : 'Taille de l\'Installateur:'}</span>
              <span className="font-mono text-slate-300">~ 48 MB (Inno Setup)</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{isAr ? 'محرك البيانات المقاوم للانقطاع:' : 'Moteur de Données:'}</span>
              <span className="font-mono text-emerald-400">SQLite 3 (WAL Mode Active)</span>
            </div>
          </div>
        </div>

        {/* BarakaDEV Developer Keygen Tool */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            <span>{isAr ? 'مولد مفاتيح التفعيل لموزعي BarakaDEV' : 'Générateur de Clés (BarakaDEV Keygen)'}</span>
          </h3>

          <p className="text-xs text-slate-400">
            {isAr
              ? 'أداة تقنية مدمجة لفريق المبيعات لتوليد كود التفعيل للزبون عند إرساله لمعرف جهازه (HWID) بعد استلام 5,000 دج.'
              : 'Outil interne pour générer instantanément la clé permanente à fournir au client après paiement des 5,000 DZD.'}
          </p>

          <form onSubmit={handleGenerateKey} className="space-y-3">
            <div>
              <label className="text-xs text-slate-300 block mb-1">
                {isAr ? 'أدخل معرف عتاد الزبون (HWID):' : 'Saisir le HWID du Client:'}
              </label>
              <input
                type="text"
                required
                value={keygenInputHWID}
                onChange={e => setKeygenInputHWID(e.target.value)}
                placeholder="Ex: BM-A8DF-92KJ-4XLP"
                className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-xs text-white font-mono uppercase outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-950/40 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              <span>{isAr ? 'توليد مفتاح التفعيل الدائم' : 'Calculer Clé d\'Activation'}</span>
            </button>
          </form>

          {generatedResult && (
            <div className="p-3 bg-[#0b0f17] border border-amber-500/40 rounded-xl space-y-1 animate-in fade-in">
              <span className="text-[10px] text-amber-300/80 font-semibold uppercase">
                {isAr ? 'كود التفعيل المتولد للزبون:' : 'Clé Générée Prête à Transmettre:'}
              </span>
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono font-bold text-amber-300">
                  {generatedResult}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(generatedResult)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Technical Architecture Guarantees */}
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
        <h3 className="text-sm font-bold text-white mb-3">
          {isAr ? 'المعايير الهندسية لضمان الاستقرار في الجزائر (Architecture Highlights)' : 'Garanties d\'Exploitation & Zéro Maintenance'}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300">
          <div className="bg-[#162030] p-3.5 rounded-xl border border-[#233145] space-y-1">
            <div className="font-bold text-emerald-400 flex items-center gap-1.5">
              <Zap className="w-4 h-4" />
              <span>Power-Failure Resilience</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              {isAr
                ? 'حماية كاملة من انقطاع الكهرباء المفاجئ بفضل معمارية SQLite WAL وحفظ المسودات اللحظي (Instant Draft Save).'
                : 'Préservation intégrale des transactions en cours lors des coupures de courant imprévues.'}
            </p>
          </div>

          <div className="bg-[#162030] p-3.5 rounded-xl border border-[#233145] space-y-1">
            <div className="font-bold text-amber-400 flex items-center gap-1.5">
              <Database className="w-4 h-4" />
              <span>Zero-Config Self-Healing</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              {isAr
                ? 'بدون الحاجة لتنصيب خوادم SQL خارجية معقدة؛ تشغيل فوري بنقرة واحدة وتكلفة دعم فني تقارب الصفر.'
                : 'Aucune dépendance externe ni configuration complexe de serveur SQL distant.'}
            </p>
          </div>

          <div className="bg-[#162030] p-3.5 rounded-xl border border-[#233145] space-y-1">
            <div className="font-bold text-sky-400 flex items-center gap-1.5">
              <HardDrive className="w-4 h-4" />
              <span>Pilote ESC/POS Direct</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              {isAr
                ? 'دعم الطابعات الحرارية عبر منافذ USB/COM والموازين الإلكترونية ببروتوكول ESC/POS القياسي.'
                : 'Impression ultra-rapide sur ticket thermique 80mm/58mm sans boîte de dialogue encombrante.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
