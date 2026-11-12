import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Scale, Barcode, CheckCircle, X, ShoppingBag, Cable, Search, Minus, Plus } from 'lucide-react';
import { formatDZD, formatGrams } from '../../core/display';
import { connectLiveScale, type ScaleLiveStatus } from '../../hardware/scale';

interface ScaleSimulationModalProps {
  onClose: () => void;
}

export const ScaleSimulationModal: React.FC<ScaleSimulationModalProps> = ({ onClose }) => {
  const { products, scanBarcode, language, setHardwareScaleActive, setScaleWeightGrams } = useApp();
  const isAr = language === 'ar';

  const scaleProducts = products.filter(p => p.is_scale_product || p.unit === 'KG');
  const [selectedProductId, setSelectedProductId] = useState<number>(
    scaleProducts.length > 0 ? scaleProducts[0].id : 4
  );
  const [weightKg, setWeightKg] = useState<number>(1.45); // default 1.45 kg matching prompt receipt example
  const [query, setQuery] = useState('');
  const shownProducts = scaleProducts.filter(p => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return p.name_fr.toLowerCase().includes(q) || p.name_ar.includes(query.trim()) || p.barcode.includes(q);
  });

  // T6 (ADR-029): live RS-232/USB scale via Web Serial. Streams into the
  // same simulated weight so the rest of the flow (barcode + POS) is
  // identical; abort on close/unmount. Absent serial => button explains.
  const [liveStatus, setLiveStatus] = useState<ScaleLiveStatus | 'idle'>('idle');
  const [liveStable, setLiveStable] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const handleLiveConnect = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setLiveStatus('idle');
      return;
    }
    const ctl = new AbortController();
    abortRef.current = ctl;
    void connectLiveScale(
      (grams, stable) => {
        setWeightKg(Math.round(grams) / 1000);
        setLiveStable(stable);
      },
      ctl.signal,
      { onStatus: (s) => { setLiveStatus(s); if (s === 'closed' || s === 'error') abortRef.current = null; } },
    ).then((st) => {
      if (st === 'unsupported') setLiveStatus('unsupported');
    });
  };

  const selectedProduct = products.find(p => p.id === selectedProductId) || scaleProducts[0];

  // Generate 20XXXXXWWWWWC scale barcode
  const itemCode = selectedProduct?.scale_item_code || '00040';
  const grams = Math.round(weightKg * 1000);
  const gramsPadded = String(grams).padStart(5, '0');
  // Checksum calculation simulation
  const generatedBarcode = `20${itemCode}${gramsPadded}1`;
  const estimatedPrice = selectedProduct ? Math.round(selectedProduct.sell_price * weightKg) : 0;

  const handleInjectToPos = () => {
    // Inject barcode to POS scanner
    scanBarcode(generatedBarcode);
    // Also sync scale hardware weight
    setScaleWeightGrams(grams);
    setHardwareScaleActive(true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#111722] border border-amber-500/20 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header — brand + live status at a glance */}
        <div className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between bg-[#0b0f17]">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">
                {isAr ? 'الميزان — وزن وحقن (F6)' : 'Balance — pesée & injection (F6)'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isAr ? 'اختر الصنف ← اضبط الوزن ← احقن في السلة' : 'Article → poids → injection panier'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${liveStatus === 'live' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300' : 'bg-[#162030] border-[#2b3a4f] text-slate-400'}`} dir="ltr">
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${liveStatus === 'live' ? (liveStable ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse') : 'bg-slate-600'}`} />
              {liveStatus === 'live' ? (liveStable ? (isAr ? 'ثابت' : 'STABLE') : '…') : (isAr ? 'محاكاة' : 'SIMU')}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Product picker with instant filter */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-bold text-slate-200">
                {isAr ? '1 · الصنف الموزون:' : '1 · Article à peser :'}
              </label>
              <div className="relative ms-auto w-44">
                <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={isAr ? 'ابحث عن صنف…' : 'Rechercher un article…'}
                  className="w-full bg-[#0b0f17] border border-[#2b3a4f] rounded-lg ps-8 pe-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-amber-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto pe-0.5">
              {shownProducts.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProductId(p.id)}
                  className={`p-2.5 rounded-xl border text-start transition-all cursor-pointer ${
                    selectedProductId === p.id
                      ? 'bg-amber-950/60 border-amber-500 text-white'
                      : 'bg-[#162030] border-[#2b3a4f] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="text-xs font-bold truncate">{isAr ? p.name_ar : p.name_fr}</div>
                  <div className="text-[11px] text-amber-400/90 font-mono mt-0.5">
                    {formatDZD(p.sell_price, false)} / kg
                  </div>
                </button>
              ))}
              {shownProducts.length === 0 && (
                <div className="col-span-2 text-center text-xs text-slate-500 py-3">
                  {isAr ? 'لا صنف مطابق — امسح باركود الميزان مباشرة.' : 'Aucun article — scannez le ticket balance.'}
                </div>
              )}
            </div>
          </div>

          {/* 2 · Scale plateau — LED digits, steppers, presets, live link */}
          <div className="bg-[#0b0f17] border border-[#1e293b] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-200">
                {isAr ? '2 · الوزن على اللوحة:' : '2 · Poids sur le plateau :'}
              </span>
              <div className="ms-auto flex items-center gap-1.5" dir="ltr">
                {[-0.1, -0.05, 0.05, 0.1].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setWeightKg(w => Math.max(0.05, Math.round((w + d) * 1000) / 1000))}
                    className="px-2 py-1 bg-[#162030] hover:bg-[#233145] border border-[#2b3a4f] text-slate-300 rounded-lg text-xs font-mono cursor-pointer flex items-center gap-0.5"
                    title={isAr ? 'ضبط دقيق ±' : 'Ajust fin ±'}
                  >
                    {d > 0 ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}{Math.abs(d * 1000)}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-center text-5xl font-black font-mono text-emerald-400 tracking-tight" dir="ltr">
              {formatGrams(weightKg)}
            </div>

            {/* Slider */}
            <input
              type="range"
              min="0.05"
              max="10"
              step="0.05"
              value={weightKg}
              onChange={e => setWeightKg(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />

            {/* Quick Weight Chips */}
            <div className="flex justify-center gap-1.5 flex-wrap">
              {[0.25, 0.5, 1.0, 1.45, 2.0, 3.5, 5.0].map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeightKg(w)}
                  className={`px-2 py-0.5 rounded text-xs font-mono border cursor-pointer ${weightKg === w ? 'bg-amber-600 border-amber-500 text-white' : 'bg-[#162030] hover:bg-[#233145] text-slate-300 border-[#2b3a4f]'}`}
                >
                  {w === 1.45 ? '1450' : Math.round(w * 1000)} g
                </button>
              ))}
            </div>

            {/* T6 live scale lane */}
            <button
              type="button"
              onClick={handleLiveConnect}
              className="w-full mt-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
            >
              <Cable className="w-4 h-4" />
              {liveStatus === 'live'
                ? (isAr ? `ميزان حي: ${formatGrams(weightKg)} ${liveStable ? '— ثابت' : '…'}` : `Live: ${formatGrams(weightKg)} ${liveStable ? 'STABLE' : '…'}`)
                : liveStatus === 'connecting'
                  ? (isAr ? 'اختر منفذ الميزان…' : 'Pick the scale port…')
                  : liveStatus === 'unsupported'
                    ? (isAr ? 'لا Serial في هذا المتصفح' : 'No Web Serial here')
                    : (isAr ? 'ربط الميزان الحي RS-232/USB' : 'Connect live scale RS-232/USB')}
            </button>
          </div>

          {/* 3 · Ticket to inject — barcode + computed total */}
          <div className="bg-[#162030] border border-amber-500/25 rounded-xl p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold text-slate-200">{isAr ? '3 · تذكرة الميزان للحقن:' : '3 · Ticket à injecter :'}</div>
              <div className="text-sm font-mono font-bold text-amber-300 tracking-widest mt-0.5 truncate" dir="ltr">
                {generatedBarcode}
              </div>
            </div>
            <div className="text-end shrink-0">
              <div className="text-[10px] text-slate-400">{isAr ? 'الإجمالي:' : 'Total :'}</div>
              <div className="text-lg font-mono font-black text-emerald-400">
                {formatDZD(estimatedPrice, false)}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#0b0f17] border-t border-[#1e293b] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#162030] text-slate-300 hover:text-white rounded-xl text-xs cursor-pointer"
          >
            {isAr ? 'إلغاء' : 'Fermer'}
          </button>
          <button
            type="button"
            onClick={handleInjectToPos}
            className="px-5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer btn-warm-cta"
          >
            <Barcode className="w-4 h-4" />
            <span>{isAr ? 'تمرير كباركود للميزان (Scan)' : 'Scanner dans la Caisse'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
