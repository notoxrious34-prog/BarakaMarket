import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Scale, Barcode, CheckCircle, X, ShoppingBag } from 'lucide-react';
import { formatDZD } from '../../core/display';

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
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between bg-[#0b0f17]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {isAr ? 'محاكي ميزان التجزئة الإلكتروني (RS232/USB)' : 'Simulateur Balance Électronique'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isAr ? 'توليد باركود الميزان الذكي (20XXXXXWWWWWC)' : 'Génération Code-barres Balance Automatique'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Select Scale Produce / Meat */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              {isAr ? 'اختر مادة للوزن (خضر / فواكه / لحوم / أجبان):' : 'Article au Poids (Fruits/Légumes/Boucherie):'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {scaleProducts.map(p => (
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
            </div>
          </div>

          {/* Weight adjustment */}
          <div className="bg-[#0b0f17] border border-[#1e293b] rounded-xl p-4 text-center space-y-3">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider">
              {isAr ? 'الوزن المقاس على لوحة الميزان' : 'Poids Mesuré sur le Plateau'}
            </span>
            <div className="text-4xl font-black font-mono text-emerald-400 tracking-tight">
              {weightKg.toFixed(3)} <span className="text-lg text-slate-400 font-normal">kg</span>
            </div>

            {/* Slider */}
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.05"
              value={weightKg}
              onChange={e => setWeightKg(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />

            {/* Quick Weight Chips */}
            <div className="flex justify-center gap-1.5 pt-1">
              {[0.5, 1.0, 1.45, 2.0, 3.5].map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeightKg(w)}
                  className="px-2 py-0.5 bg-[#162030] hover:bg-[#233145] text-slate-300 rounded text-xs font-mono border border-[#2b3a4f] cursor-pointer"
                >
                  {w} kg
                </button>
              ))}
            </div>
          </div>

          {/* Barcode Output Preview */}
          <div className="bg-[#162030] border border-[#2b3a4f] rounded-xl p-3 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400">{isAr ? 'ملصق الباركود المتولد:' : 'Code Balance Généré:'}</div>
              <div className="text-sm font-mono font-bold text-amber-300 tracking-widest mt-0.5">
                {generatedBarcode}
              </div>
            </div>
            <div className="text-end">
              <div className="text-[10px] text-slate-400">{isAr ? 'السعر المقدر:' : 'Prix Calculé:'}</div>
              <div className="text-sm font-mono font-bold text-emerald-400">
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
            className="px-5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer"
          >
            <Barcode className="w-4 h-4" />
            <span>{isAr ? 'تمرير كباركود للميزان (Scan)' : 'Scanner dans la Caisse'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
