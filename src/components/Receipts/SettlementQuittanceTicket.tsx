import React from 'react';
import { useApp } from '../../context/AppContext';
import { formatDZD } from '../../core/display';
import { buildQuittance, downloadRaw } from '../../hardware/escpos';
import { Printer, X } from 'lucide-react';

/**
 * EXEC-DIR-2023-001 TASK 3 — Quittance de Règlement de Dette (80mm thermal).
 * Art. 136: ESPECES settlements >= 50 DZD show timbre; other methods exempt.
 * Auto-opened by AppContext.settleClientDebt via lastSettlementQuittance.
 */
export const SettlementQuittanceTicket: React.FC = () => {
  const { lastSettlementQuittance, closeSettlementQuittance, storeProfile, language } = useApp();
  if (!lastSettlementQuittance) return null;
  const q = lastSettlementQuittance;
  const isAr = language === 'ar';
  const timbre = q.timbre_fiscal ?? 0;
  const collected = q.total_collected ?? q.amount;

  const handlePrint = () => window.print();

  /** Gate-02 TASK 2 Lane A: raw quittance .bin export. */
  const handleDownloadRaw = () => {
    const buf = buildQuittance({
      storeName: storeProfile.store_name,
      receipt: q.receipt_number ?? q.id,
      date: formattedDate,
      clientName: q.client_name,
      prevBalance: q.prev_balance,
      amount: q.amount,
      timbre: q.timbre_fiscal ?? 0,
      collected: q.total_collected ?? q.amount,
      newBalance: q.new_balance,
      paymentMethod: q.payment_method,
    });
    downloadRaw(buf, `${q.receipt_number ?? q.id}.bin`);
  };
  const formattedDate = new Date(q.date).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col my-auto">
        <div className="px-5 py-3.5 border-b border-[#1e293b] flex items-center justify-between bg-[#0b0f17]">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">
              {isAr ? 'وصل تسديد دين (Quittance de Règlement)' : 'Quittance de Règlement de Dette'}
            </h3>
          </div>
          <button onClick={closeSettlementQuittance} className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 bg-[#070a0f] flex justify-center max-h-[70vh] overflow-y-auto">
          <div id="printable-receipt" className="w-[80mm] max-w-[80mm] bg-white text-black p-4 font-mono text-[11px] leading-snug" dir="ltr">
            <div className="text-center font-bold text-[13px]">{storeProfile.store_name}</div>
            <div className="text-center">{storeProfile.company_owner}</div>
            <div className="text-center">{storeProfile.address}</div>
            <div className="text-center">NIF:{storeProfile.nif_number} RC:{storeProfile.rc_number}</div>
            <div className="text-center">NIS:{storeProfile.nis_number} AI:{storeProfile.ai_number}</div>
            <div className="border-t border-dashed border-black my-2" />
            <div className="font-bold text-center">QUITTANCE {q.receipt_number}</div>
            <div className="text-center">{formattedDate} — {q.payment_method}</div>
            <div className="border-t border-dashed border-black my-2" />
            <div>Client: {q.client_name}</div>
            <div>Dette avant: {formatDZD(q.prev_balance, false)}</div>
            <div>Montant encaissé: {formatDZD(q.amount, false)}</div>
            <div>Droit de Timbre (Art.136): {timbre > 0 ? `+${formatDZD(timbre, false)}` : 'Exempté'}</div>
            <div className="font-bold">Total collecté: {formatDZD(collected, false)}</div>
            <div>Solde restant: {formatDZD(q.new_balance, false)}</div>
            {q.note && <div>Note: {q.note}</div>}
            <div className="border-t border-dashed border-black my-2" />
            <div className="text-center text-[10px]">
              Reçu tenant lieu de quittance pour paiement d&apos;une créance commerciale.
            </div>
            <div className="text-center text-[10px]">
              وصل يعتبر بمثابة إبراء ذمة عن تسديد دين تجاري.
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#1e293b] flex items-center gap-2 bg-[#0b0f17]">
          <button onClick={handlePrint} className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold transition-colors cursor-pointer">
            {isAr ? 'طباعة الوصل (80mm)' : 'Imprimer Quittance'}
          </button>
          <button onClick={handleDownloadRaw} title="ESC/POS Lane A (.bin)" className="px-3 py-2 bg-[#162030] border border-[#2b3a4f] text-slate-300 rounded-xl text-sm cursor-pointer">
            .bin
          </button>
          <button onClick={closeSettlementQuittance} className="px-4 py-2 bg-[#162030] border border-[#2b3a4f] text-slate-300 rounded-xl text-sm transition-colors cursor-pointer">
            {isAr ? 'إغلاق' : 'Fermer'}
          </button>
        </div>
      </div>
    </div>
  );
};
