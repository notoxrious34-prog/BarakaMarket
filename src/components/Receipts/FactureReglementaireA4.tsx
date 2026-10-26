import React from 'react';
import { useApp } from '../../context/AppContext';
import { Sale } from '../../types';
import { formatDZD } from '../../core/display';
import { numberToWordsAR, numberToWordsFR } from '../../core/legal';
import { Printer, X, FileText, CheckCircle2 } from 'lucide-react';

interface FactureReglementaireProps {
  sale: Sale;
  onClose: () => void;
}

export const FactureReglementaireA4: React.FC<FactureReglementaireProps> = ({ sale, onClose }) => {
  const { storeProfile, language } = useApp();
  const isAr = language === 'ar';

  const handlePrint = () => {
    window.print();
  };

  const invoiceDate = new Date(sale.created_at).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const wordsFR = numberToWordsFR(sale.total_ttc);
  const wordsAR = numberToWordsAR(sale.total_ttc);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col my-auto">
        {/* Modal Controls Header */}
        <div className="px-5 py-3.5 border-b border-[#1e293b] flex items-center justify-between bg-[#0b0f17]">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white">
              {isAr ? 'الفاتورة التجارية القانونية الرسمية (Modèle Facture DGI A4)' : 'Facture Réglementaire Algérienne (Modèle A4)'}
            </h3>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{isAr ? 'طباعة الفاتورة (A4)' : 'Imprimer Facture A4'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable A4 Container */}
        <div className="p-6 bg-[#070a0f] flex justify-center max-h-[80vh] overflow-y-auto">
          <div
            id="printable-facture-a4"
            className="w-[210mm] min-h-[297mm] bg-white text-slate-900 p-10 font-sans shadow-2xl rounded-sm text-xs leading-relaxed border border-slate-300"
            dir="ltr"
          >
            {/* Top Seller Header & Official Mentions */}
            <div className="border-b-2 border-emerald-800 pb-4 flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-black text-emerald-900 tracking-tight">
                  {storeProfile.store_name}
                </h1>
                <p className="text-sm font-semibold text-slate-700 mt-0.5">
                  {storeProfile.company_owner}
                </p>
                <p className="text-xs text-slate-600 mt-1">{storeProfile.address}</p>
                <p className="text-xs text-slate-600">Tél: {storeProfile.phone}</p>
              </div>

              {/* Fiscal Identification Numbers Box */}
              <div className="bg-slate-50 border border-slate-300 rounded-lg p-3 text-[11px] space-y-1 min-w-[280px]">
                <div className="font-bold text-slate-800 border-b pb-1 mb-1">
                  IDENTIFIANTS FISCAUX (DGI / CNRC)
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-medium">NIF (15 chiffres):</span>
                  <span className="font-mono font-bold">{storeProfile.nif_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-medium">NIS:</span>
                  <span className="font-mono font-bold">{storeProfile.nis_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-medium">R.C:</span>
                  <span className="font-mono font-bold">{storeProfile.rc_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-medium">Art. Imposition:</span>
                  <span className="font-mono font-bold">{storeProfile.ai_number}</span>
                </div>
              </div>
            </div>

            {/* Facture Title & Client Section */}
            <div className="grid grid-cols-2 gap-6 my-6">
              {/* Invoice Meta */}
              <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-3.5 space-y-1.5">
                <div className="text-lg font-black text-emerald-900">
                  FACTURE N° {sale.invoice_number}
                </div>
                <div className="text-xs text-slate-700">
                  <strong>Date d&apos;émission:</strong> {invoiceDate}
                </div>
                <div className="text-xs text-slate-700">
                  <strong>Mode de Paiement:</strong> {sale.payment_method}
                </div>
                <div className="text-xs text-slate-700">
                  <strong>Référence Caisse:</strong> {sale.ticket_number} (Caisse 01)
                </div>
              </div>

              {/* Client DOIT Info */}
              <div className="border border-slate-300 rounded-lg p-3.5 space-y-1 bg-white">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  DOIT (CLIENT):
                </div>
                <div className="text-sm font-bold text-slate-900">
                  {sale.client_name || 'Client Passager'}
                </div>
                <div className="text-xs text-slate-600">
                  {sale.client_address || 'Vente Comptoir'}
                </div>
                {sale.client_nif && (
                  <div className="text-[11px] text-slate-700 pt-1 font-mono">
                    NIF: {sale.client_nif} | RC: {sale.client_rc || '-'}
                  </div>
                )}
                {sale.client_nis && (
                  <div className="text-[11px] text-slate-700 font-mono">
                    NIS: {sale.client_nis} | AI: {sale.client_ai || '-'}
                  </div>
                )}
              </div>
            </div>

            {/* Goods Table */}
            <div className="border border-slate-300 rounded-lg overflow-hidden my-4">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3 w-10 text-center">N°</th>
                    <th className="py-2.5 px-3">Désignation des Marchandises</th>
                    <th className="py-2.5 px-3 w-16 text-center">Unité</th>
                    <th className="py-2.5 px-3 w-16 text-center">Qté</th>
                    <th className="py-2.5 px-3 w-24 text-end">P.U HT (DZD)</th>
                    <th className="py-2.5 px-3 w-16 text-center">TVA</th>
                    <th className="py-2.5 px-3 w-28 text-end">Total TTC (DZD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sale.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="py-2 px-3 text-center text-slate-500">{idx + 1}</td>
                      <td className="py-2 px-3">
                        <div className="font-semibold text-slate-900">{item.name_fr}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{item.barcode}</div>
                      </td>
                      <td className="py-2 px-3 text-center text-slate-600">{item.unit}</td>
                      <td className="py-2 px-3 text-center font-bold text-slate-800">
                        {item.quantity}
                      </td>
                      <td className="py-2 px-3 text-end font-mono">
                        {(item.total_line_ht / item.quantity).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className="font-semibold px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">
                          {item.tva_rate}%
                        </span>
                      </td>
                      <td className="py-2 px-3 text-end font-mono font-bold text-slate-900">
                        {item.total_line_ttc.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bottom Section: Tax Breakdown & Financial Totals */}
            <div className="grid grid-cols-2 gap-6 my-6 items-start">
              {/* Algerian Fiscal Tax Breakdown (TVA Recapitulative) */}
              <div className="border border-slate-300 rounded-lg p-3 bg-slate-50/50">
                <div className="text-xs font-bold text-slate-800 mb-2 border-b pb-1">
                  RÉCAPITULATION FISCALE DES TAXES (TVA DGI)
                </div>
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-slate-500 font-semibold border-b border-slate-200">
                      <th className="py-1">Taux TVA</th>
                      <th className="py-1 text-end">Base HT (DZD)</th>
                      <th className="py-1 text-end">Montant TVA (DZD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono">
                    <tr>
                      <td className="py-1 text-slate-600">Taux 0% (Exempt)</td>
                      <td className="py-1 text-end">
                        {sale.tva_breakdown ? sale.tva_breakdown[0]?.base_ht.toFixed(2) : '0.00'}
                      </td>
                      <td className="py-1 text-end">0.00</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-600">Taux Réduit 9%</td>
                      <td className="py-1 text-end">
                        {sale.tva_breakdown ? sale.tva_breakdown[9]?.base_ht.toFixed(2) : '0.00'}
                      </td>
                      <td className="py-1 text-end">
                        {sale.tva_breakdown ? sale.tva_breakdown[9]?.tva_amount.toFixed(2) : '0.00'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-600">Taux Normal 19%</td>
                      <td className="py-1 text-end">
                        {sale.tva_breakdown ? sale.tva_breakdown[19]?.base_ht.toFixed(2) : '0.00'}
                      </td>
                      <td className="py-1 text-end">
                        {sale.tva_breakdown ? sale.tva_breakdown[19]?.tva_amount.toFixed(2) : '0.00'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Financial Totals */}
              <div className="border border-slate-300 rounded-lg p-3 bg-white space-y-1.5 font-mono text-xs">
                <div className="flex justify-between text-slate-700">
                  <span>TOTAL GÉNÉRAL HT:</span>
                  <span className="font-bold">{sale.total_ht.toFixed(2)} DZD</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>TOTAL TVA:</span>
                  <span className="font-bold">{sale.total_tva.toFixed(2)} DZD</span>
                </div>
                {sale.timbre_fiscal > 0 && (
                  <div className="flex justify-between text-amber-800">
                    <span>DROIT DE TIMBRE (Espèces 1%):</span>
                    <span className="font-bold">{sale.timbre_fiscal.toFixed(2)} DZD</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-black text-emerald-900 border-t-2 border-slate-800 pt-2">
                  <span>NET À PAYER (TTC):</span>
                  <span>{sale.total_ttc.toFixed(2)} DZD</span>
                </div>
              </div>
            </div>

            {/* Arrêté de facture en toutes lettres (French & Arabic) */}
            <div className="border border-slate-300 rounded-lg p-3.5 bg-slate-50 my-4 space-y-1 text-xs">
              <div className="font-semibold text-slate-700">
                Arrêtée la présente facture à la somme de:
              </div>
              <div className="font-bold text-slate-900 italic">
                {wordsFR}
              </div>
              <div className="font-bold text-slate-800 text-end font-arabic pt-1" dir="rtl">
                أوقفت هذه الفاتورة عند مبلغ: {wordsAR}
              </div>
            </div>

            {/* Signature & Cachet Box */}
            <div className="flex justify-end pt-6">
              <div className="w-64 border-2 border-dashed border-slate-300 rounded-xl p-4 text-center h-28 flex flex-col justify-between">
                <span className="text-[11px] font-bold text-slate-600 uppercase">
                  Cachet et Signature du Fournisseur
                </span>
                <span className="text-[10px] text-slate-400">ETS MOHAMED EL-BARAKA</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#0b0f17] border-t border-[#1e293b] flex items-center justify-between">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{isAr ? 'نموذج مطابق لتعليمات المديرية العامة للضرائب (DGI)' : 'Conforme aux exigences DGI et Code du Commerce'}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-[#162030] text-slate-300 hover:text-white rounded-xl text-xs font-semibold cursor-pointer"
          >
            {isAr ? 'إغلاق' : 'Fermer'}
          </button>
        </div>
      </div>
    </div>
  );
};
