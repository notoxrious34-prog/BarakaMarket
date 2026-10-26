import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatDZD } from '../../utils/fiscal';
import {
  FileText,
  Printer,
  CheckCircle,
  Calendar,
  DollarSign,
  CreditCard,
  BookOpen,
  ArrowDownLeft,
  Percent,
} from 'lucide-react';

export const DailyZReportView: React.FC = () => {
  const { generateDailyZReport, storeProfile, language } = useApp();
  const isAr = language === 'ar';

  const [zReport] = useState(() => generateDailyZReport());

  const handlePrintZ = () => {
    window.print();
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-80px)] bg-[#0b0f17] p-4 gap-6 overflow-y-auto">
      {/* Left: Interactive Dashboard & Fiscal Breakdown Summary */}
      <div className="flex-1 space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-400" />
              <span>{isAr ? 'تقرير الإغلاق المالي والجبائي اليومي (Rapport Z de Caisse)' : 'Rapport Z de Clôture Journalière'}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isAr
                ? 'مطابق لمعايير المراقبة الجبائية للمديرية العامة للضرائب (DGI)'
                : 'Conforme aux normes de contrôle fiscal DGI et traçabilité'}
            </p>
          </div>

          <button
            onClick={handlePrintZ}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{isAr ? 'طباعة تقرير Z' : 'Imprimer Ticket Z'}</span>
          </button>
        </div>

        {/* Global Financial Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 font-semibold uppercase">{isAr ? 'إجمالي المبيعات TTC' : 'Chiffre Affaires TTC'}</span>
            <div className="text-xl font-black text-emerald-400 font-mono mt-1">
              {formatDZD(zReport.total_ttc, false)}
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">{zReport.sales_count} {isAr ? 'عمليات بيع اليوم' : 'ventes enregistrées'}</span>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 font-semibold uppercase">{isAr ? 'المجموع بدون ضرائب HT' : 'Total Hors Taxes (HT)'}</span>
            <div className="text-xl font-black text-white font-mono mt-1">
              {formatDZD(zReport.total_ht, false)}
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">{isAr ? 'وعاء الضريبة الإجمالي' : 'Base imposable globale'}</span>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 font-semibold uppercase">{isAr ? 'مجموع الرسم TVA' : 'Total TVA Collectée'}</span>
            <div className="text-xl font-black text-amber-400 font-mono mt-1">
              {formatDZD(zReport.total_tva, false)}
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">TVA 0%, 9%, 19%</span>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 font-semibold uppercase">{isAr ? 'حق الطابع المالي' : 'Timbre Fiscal (Espèces)'}</span>
            <div className="text-xl font-black text-amber-300 font-mono mt-1">
              {formatDZD(zReport.total_timbre, false)}
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">{isAr ? 'المادة 136 قانون الطابع' : 'Art. 136 Code du Timbre'}</span>
          </div>
        </div>

        {/* TVA Breakdown Table by Tax Rate */}
        <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Percent className="w-4 h-4 text-emerald-400" />
            <span>{isAr ? 'تفصيل الأوعية والمبالغ الضريبية (TVA Breakdown)' : 'Ventilation de la TVA par Taux'}</span>
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead>
                <tr className="bg-[#0b0f17] text-slate-400 uppercase text-[10px] font-semibold border-b border-[#1e293b]">
                  <th className="py-2.5 px-3 text-start">{isAr ? 'نسبة الرسم' : 'Taux TVA'}</th>
                  <th className="py-2.5 px-3 text-end">{isAr ? 'الوعاء الخاضع (Base HT)' : 'Assiette HT (DZD)'}</th>
                  <th className="py-2.5 px-3 text-end">{isAr ? 'مبلغ الرسم (TVA)' : 'Montant TVA (DZD)'}</th>
                  <th className="py-2.5 px-3 text-end">{isAr ? 'المجموع شامل الرسم (TTC)' : 'Total TTC (DZD)'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#162030] font-mono text-slate-300">
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-sky-400">0% ({isAr ? 'معفى قانوناً' : 'Exonéré'})</td>
                  <td className="py-2.5 px-3 text-end">{formatDZD(zReport.tva_0_base, false)}</td>
                  <td className="py-2.5 px-3 text-end text-slate-500">0.00 DZD</td>
                  <td className="py-2.5 px-3 text-end font-bold">{formatDZD(zReport.tva_0_base, false)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-amber-400">9% ({isAr ? 'المعدل المنخفض' : 'Taux Réduit'})</td>
                  <td className="py-2.5 px-3 text-end">{formatDZD(zReport.tva_9_base, false)}</td>
                  <td className="py-2.5 px-3 text-end text-amber-300">+{formatDZD(zReport.tva_9_amount, false)}</td>
                  <td className="py-2.5 px-3 text-end font-bold">{formatDZD(zReport.tva_9_base + zReport.tva_9_amount, false)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-purple-400">19% ({isAr ? 'المعدل العام' : 'Taux Normal'})</td>
                  <td className="py-2.5 px-3 text-end">{formatDZD(zReport.tva_19_base, false)}</td>
                  <td className="py-2.5 px-3 text-end text-purple-300">+{formatDZD(zReport.tva_19_amount, false)}</td>
                  <td className="py-2.5 px-3 text-end font-bold">{formatDZD(zReport.tva_19_base + zReport.tva_19_amount, false)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment Methods Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span>{isAr ? 'المحصل نقداً في الصندوق:' : 'Espèces en Caisse:'}</span>
            </div>
            <div className="text-lg font-black font-mono text-emerald-400 mt-1">
              {formatDZD(zReport.total_especes, false)}
            </div>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <CreditCard className="w-4 h-4 text-amber-400" />
              <span>{isAr ? 'الذهبية / CIB:' : 'Carte Dahabiya / CIB:'}</span>
            </div>
            <div className="text-lg font-black font-mono text-amber-400 mt-1">
              {formatDZD(zReport.total_cib_dahabiya, false)}
            </div>
          </div>

          <div className="bg-[#111722] border border-[#1e293b] rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <BookOpen className="w-4 h-4 text-rose-400" />
              <span>{isAr ? 'ديون جديدة (كريدي اليوم):' : 'Crédit Accordé:'}</span>
            </div>
            <div className="text-lg font-black font-mono text-rose-400 mt-1">
              {formatDZD(zReport.total_credit_granted, false)}
            </div>
          </div>
        </div>
      </div>

      {/* Right: Thermal Z-Ticket Preview for 80mm ESC/POS */}
      <div className="w-full lg:w-80 flex flex-col items-center">
        <span className="text-xs font-semibold text-slate-400 mb-2">
          {isAr ? 'معاينة وصل الإغلاق (Ticket Z 80mm)' : 'Ticket Z ESC/POS 80mm'}
        </span>

        <div
          id="printable-receipt"
          dir="ltr"
          className="w-full max-w-[300px] bg-white text-black p-4 font-mono text-[11px] leading-tight shadow-2xl border border-slate-300 select-text text-start"
          style={{ fontFamily: "'Courier New', Courier, monospace" }}
        >
          <div className="text-center space-y-0.5 border-b border-black pb-2">
            <div className="font-bold text-sm tracking-wider uppercase">{storeProfile.store_name}</div>
            <div className="font-semibold text-xs">{storeProfile.company_owner}</div>
            <div className="text-[10px]">{storeProfile.address}</div>
            <div className="text-[9.5px]">RC: {storeProfile.rc_number} | NIF: {storeProfile.nif_number}</div>
            <div className="text-[9.5px]">NIS: {storeProfile.nis_number} | AI: {storeProfile.ai_number}</div>
          </div>

          <div className="py-2 border-b border-black text-center">
            <div className="font-bold text-sm uppercase">*** RAPPORT Z DE CAISSE ***</div>
            <div className="text-[10px]">CLÔTURE JOURNALIÈRE FISCALE</div>
            <div className="text-[10px] pt-1">
              Rapport N°: {zReport.report_number}
            </div>
            <div className="text-[10px]">
              Date: {zReport.date} - Heure: {zReport.closed_at}
            </div>
          </div>

          <div className="py-2 border-b border-black space-y-1 text-[10px]">
            <div className="flex justify-between">
              <span>Nombre de Ventes:</span>
              <span className="font-bold">{zReport.sales_count}</span>
            </div>
            <div className="flex justify-between">
              <span>Total HT:</span>
              <span>{zReport.total_ht.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>TVA 9% (Base {zReport.tva_9_base.toFixed(2)}):</span>
              <span>{zReport.tva_9_amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>TVA 19% (Base {zReport.tva_19_base.toFixed(2)}):</span>
              <span>{zReport.tva_19_amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Timbre Fiscal (Espèces):</span>
              <span>{zReport.total_timbre.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-black text-xs pt-1 border-t border-black">
              <span>TOTAL TTC:</span>
              <span>{zReport.total_ttc.toFixed(2)} DZD</span>
            </div>
          </div>

          <div className="py-2 border-b border-black space-y-1 text-[10px]">
            <div className="font-bold uppercase pb-0.5">Ventilation des Paiements:</div>
            <div className="flex justify-between">
              <span>Espèces:</span>
              <span>{zReport.total_especes.toFixed(2)} DZD</span>
            </div>
            <div className="flex justify-between">
              <span>CIB / Dahabiya:</span>
              <span>{zReport.total_cib_dahabiya.toFixed(2)} DZD</span>
            </div>
            <div className="flex justify-between">
              <span>Crédit Client (Carnet):</span>
              <span>{zReport.total_credit_granted.toFixed(2)} DZD</span>
            </div>
            <div className="flex justify-between">
              <span>Règlements Crédits Reçus:</span>
              <span>{zReport.total_credit_settled.toFixed(2)} DZD</span>
            </div>
          </div>

          <div className="text-center pt-2 space-y-0.5 text-[9px] text-slate-700">
            <div>Signé par le Caissier & Gérant</div>
            <div className="font-semibold text-slate-500 pt-1">Baraka Market v1.0 by BarakaDEV</div>
          </div>
        </div>
      </div>
    </div>
  );
};
