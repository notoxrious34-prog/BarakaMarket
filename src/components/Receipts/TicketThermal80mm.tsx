import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Sale } from '../../types';
import { formatDZD } from '../../core/display';
import { Printer, X, Download, Copy, Check, Cpu } from 'lucide-react';
import { buildReceipt, downloadRaw } from '../../hardware/escpos';

interface TicketThermalProps {
  sale: Sale;
  onClose: () => void;
}

export const TicketThermal80mm: React.FC<TicketThermalProps> = ({ sale, onClose }) => {
  const { storeProfile, language } = useApp();
  const [copied, setCopied] = useState(false);
  const [ticketWidth, setTicketWidth] = useState<'80mm' | '58mm'>('80mm');

  const isAr = language === 'ar';

  const handlePrint = () => {
    window.print();
  };

  /** Gate-02 TASK 2 Lane A: raw deterministic ESC/POS .bin export. */
  const handleDownloadRaw = () => {
    const buf = buildReceipt({
      storeName: storeProfile.store_name,
      rc: storeProfile.rc_number,
      nif: storeProfile.nif_number,
      invoice: sale.invoice_number,
      ticket: sale.ticket_number,
      date: formattedDate,
      cashier: sale.cashier_name,
      items: sale.items.map(it => ({
        name: isAr ? it.name_ar || it.name_fr : it.name_fr,
        qty: it.quantity,
        unit: it.unit,
        lineTtc: it.total_line_ttc,
      })),
      totalHt: sale.total_ht,
      tva9Base: sale.tva_breakdown[9].base_ht,
      tva9Amt: sale.tva_breakdown[9].tva_amount,
      tva19Base: sale.tva_breakdown[19].base_ht,
      tva19Amt: sale.tva_breakdown[19].tva_amount,
      timbre: sale.timbre_fiscal,
      totalTtc: sale.total_ttc,
      paymentMethod: sale.payment_method,
      amountPaid: sale.amount_paid,
      changeDue: sale.amount_returned,
    });
    downloadRaw(buf, `${sale.ticket_number}.bin`);
  };

  const handleCopyRaw = () => {
    const text = document.getElementById('printable-receipt')?.innerText || '';
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedDate = new Date(sale.created_at).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col my-auto">
        {/* Modal Controls Header */}
        <div className="px-5 py-3.5 border-b border-[#1e293b] flex items-center justify-between bg-[#0b0f17]">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">
              {isAr ? 'معاينة وصل الدفع الحراري (Ticket de Caisse)' : 'Aperçu Ticket Thermique ESC/POS'}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {/* Format toggle (80mm / 58mm) */}
            <div className="bg-[#162030] p-0.5 rounded-lg border border-[#2b3a4f] flex text-[10px] font-mono">
              <button
                type="button"
                onClick={() => setTicketWidth('80mm')}
                className={`px-2 py-0.5 rounded ${ticketWidth === '80mm' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setTicketWidth('58mm')}
                className={`px-2 py-0.5 rounded ${ticketWidth === '58mm' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
              >
                58mm
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Thermal Ticket Rendering Container */}
        <div className="p-4 bg-[#070a0f] flex justify-center max-h-[75vh] overflow-y-auto">
          <div
            id="printable-receipt"
            dir="ltr"
            className={`bg-white text-black p-4 font-mono text-[11px] leading-tight shadow-2xl border border-slate-300 select-text text-start ${
              ticketWidth === '80mm' ? 'w-[320px]' : 'w-[240px]'
            }`}
            style={{ fontFamily: "'Courier New', Courier, monospace" }}
          >
            {/* Store Header */}
            <div className="text-center space-y-0.5 border-b border-black pb-2">
              <div className="font-bold text-base tracking-wider uppercase">{storeProfile.store_name}</div>
              <div className="font-semibold text-xs">{storeProfile.company_owner}</div>
              <div className="text-[10px]">{storeProfile.address}</div>
              <div className="text-[10px]">{storeProfile.phone}</div>
              <div className="text-[9.5px] pt-1">
                RC: {storeProfile.rc_number} | NIF: {storeProfile.nif_number}
              </div>
              <div className="text-[9.5px]">
                NIS: {storeProfile.nis_number} | AI: {storeProfile.ai_number}
              </div>
            </div>

            {/* Sale Meta */}
            <div className="py-2 border-b border-black text-[10px] space-y-0.5">
              <div className="flex justify-between">
                <span>Date: {formattedDate}</span>
                <span className="font-bold">{sale.ticket_number}</span>
              </div>
              <div className="flex justify-between">
                <span>Caissier: {sale.cashier_name}</span>
                <span>Caisse: 01</span>
              </div>
              {sale.client_name && sale.client_name !== 'Client Passager (Comptoir)' && (
                <div className="pt-0.5 font-semibold">
                  Client: {sale.client_name}
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="py-2 border-b border-black">
              <div className="flex justify-between font-bold pb-1 text-[10px] uppercase border-b border-dashed border-black">
                <span className="flex-1">Désignation</span>
                <span className="w-20 text-center">Qté x P.U</span>
                <span className="w-16 text-end">Total</span>
              </div>

              <div className="space-y-1.5 pt-1.5">
                {sale.items.map((item, i) => (
                  <div key={i} className="text-[10.5px]">
                    <div className="font-semibold truncate">{item.name_fr}</div>
                    <div className="flex justify-between text-[10px] text-slate-800">
                      <span>
                        {item.quantity} {item.unit === 'KG' ? 'kg' : ''} x {item.unit_price_ttc.toFixed(2)}
                      </span>
                      <span className="font-bold">
                        {item.total_line_ttc.toFixed(2)} ({item.tva_rate}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals & Algerian Fiscal Breakdown */}
            <div className="py-2 border-b border-black space-y-1 text-[10.5px]">
              <div className="flex justify-between">
                <span>Sous-Total HT:</span>
                <span>{sale.total_ht.toFixed(2)}</span>
              </div>

              {sale.tva_breakdown && (
                <>
                  {sale.tva_breakdown[9]?.tva_amount > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span>TVA 9%:</span>
                      <span>{sale.tva_breakdown[9].tva_amount.toFixed(2)}</span>
                    </div>
                  )}
                  {sale.tva_breakdown[19]?.tva_amount > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span>TVA 19%:</span>
                      <span>{sale.tva_breakdown[19].tva_amount.toFixed(2)}</span>
                    </div>
                  )}
                </>
              )}

              {sale.timbre_fiscal > 0 && (
                <div className="flex justify-between font-semibold">
                  <span>Droit de Timbre (Espèces):</span>
                  <span>{sale.timbre_fiscal.toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between font-black text-sm pt-1 border-t border-black">
                <span>TOTAL TTC:</span>
                <span>{sale.total_ttc.toFixed(2)} DZD</span>
              </div>
            </div>

            {/* Payment Details */}
            <div className="py-2 border-b border-black text-[10px] space-y-0.5">
              <div className="flex justify-between">
                <span>Mode de Règlement:</span>
                <span className="font-bold">{sale.payment_method}</span>
              </div>
              <div className="flex justify-between">
                <span>Montant Versé:</span>
                <span>{sale.amount_paid.toFixed(2)} DZD</span>
              </div>
              {sale.amount_returned > 0 && (
                <div className="flex justify-between font-bold">
                  <span>Rendu Monnaie:</span>
                  <span>{sale.amount_returned.toFixed(2)} DZD</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="text-center pt-3 pb-1 space-y-1">
              <div className="font-bold text-xs">*** شكراً لزيارتكم ***</div>
              <div className="text-[9px] text-slate-700">
                {storeProfile.receipt_footer}
              </div>
              <div className="text-[9px] font-semibold text-slate-500 pt-1">
                Baraka Market v1.0 by BarakaDEV
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 bg-[#0b0f17] border-t border-[#1e293b] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopyRaw}
            className="px-3 py-2 bg-[#162030] hover:bg-[#233145] text-slate-300 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? (isAr ? 'تم النسخ' : 'Copié') : (isAr ? 'نسخ النص' : 'Copier texte')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadRaw}
              title={isAr ? 'تصدير ملف ESC/POS الخام (Lane A)' : 'Export brut ESC/POS (Lane A)'}
              className="px-3 py-2 bg-[#162030] hover:bg-[#233145] border border-[#2b3a4f] text-slate-300 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Cpu className="w-4 h-4 text-amber-400" />
              <span>.bin</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#162030] text-slate-300 hover:text-white rounded-xl text-xs cursor-pointer"
            >
              {isAr ? 'إغلاق' : 'Fermer'}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{isAr ? 'طباعة التذكرة (ESC/POS)' : 'Imprimer Ticket'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
