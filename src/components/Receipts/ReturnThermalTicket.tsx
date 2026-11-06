import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Printer, X, Download, Copy, Check } from 'lucide-react';
import { buildReturnReceipt, downloadRaw } from '../../hardware/escpos';
import { formatDZDFromCt } from '../../core/display';

interface ReturnTicketItem {
  name_fr: string;
  qty_milli: number;
  unit: string;
  line_ttc_ct: number;
}

interface ReturnTicketProps {
  ret: {
    return_number: string | null;
    invoice_number: string;
    posting_day: string | null;
    reason: string;
    reason_note?: string | null;
    actor: string;
    approver: string;
    refund_ct: number;
    payment_method: string;
    items: ReturnTicketItem[];
  };
  onClose: () => void;
}

/** v1.5.0 — BON DE RETOUR preview: screen ticket + window.print + raw .bin. */
export const ReturnThermalTicket: React.FC<ReturnTicketProps> = ({ ret, onClose }) => {
  const { storeProfile, language } = useApp();
  const [copied, setCopied] = useState(false);
  const isAr = language === 'ar';

  const qtyLabel = (milli: number, unit: string): string =>
    unit === 'PIECE' ? `${milli / 1000}x` : unit === 'KG' ? `${milli}g` : `${milli}ml`;

  const handleDownloadRaw = () => {
    const buf = buildReturnReceipt({
      storeName: storeProfile.store_name,
      rc: storeProfile.rc_number,
      nif: storeProfile.nif_number,
      returnNumber: ret.return_number ?? 'DRAFT',
      sourceInvoice: ret.invoice_number,
      postingDay: ret.posting_day ?? '—',
      reason: ret.reason,
      reasonNote: ret.reason_note ?? undefined,
      creator: ret.actor,
      approver: ret.approver,
      items: ret.items.map(it => ({
        name: isAr ? it.name_fr : it.name_fr,
        qty: qtyLabel(it.qty_milli, it.unit),
        lineTtc: it.line_ttc_ct / 100,
      })),
      refundTotal: ret.refund_ct / 100,
      paymentMethod: ret.payment_method,
    });
    downloadRaw(buf, `${ret.return_number ?? 'return-draft'}.bin`);
  };

  const handleCopy = () => {
    const text = document.getElementById('printable-return')?.innerText || '';
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col my-auto">
        <div className="px-5 py-3.5 border-b border-[#1e293b] flex items-center justify-between bg-[#0b0f17]">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white">
              {isAr ? 'وصل الإرجاع (BON DE RETOUR)' : 'Bon de retour'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCopy} className="p-1.5 text-slate-400 hover:text-white rounded-lg" title={isAr ? 'نسخ' : 'Copier'}>
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button type="button" onClick={handleDownloadRaw} className="p-1.5 text-slate-400 hover:text-white rounded-lg" title={isAr ? 'خام ESC/POS' : 'Brut ESC/POS'}>
              <Download className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => window.print()} className="px-2 py-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">
              {isAr ? 'طباعة' : 'Imprimer'}
            </button>
            <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 bg-[#070a0f] flex justify-center max-h-[75vh] overflow-y-auto">
          <div
            id="printable-return"
            dir="ltr"
            className="bg-white text-black p-4 font-mono text-[11px] leading-tight shadow-2xl border border-slate-300 select-text text-start w-[320px]"
            style={{ fontFamily: "'Courier New', Courier, monospace" }}
          >
            <div className="text-center space-y-0.5 border-b border-black pb-2">
              <div className="font-bold text-base tracking-wider uppercase">{storeProfile.store_name}</div>
              <div className="font-bold text-sm">BON DE RETOUR</div>
              <div className="text-[9.5px]">RC: {storeProfile.rc_number} | NIF: {storeProfile.nif_number}</div>
            </div>
            <div className="py-2 border-b border-black text-[10px] space-y-0.5">
              <div className="flex justify-between font-bold"><span>{ret.return_number ?? 'DRAFT'}</span></div>
              <div>Source: {ret.invoice_number}</div>
              <div className="flex justify-between"><span>Jour: {ret.posting_day ?? '—'}</span><span>{ret.payment_method}</span></div>
              <div>Motif: {ret.reason}</div>
              {ret.reason_note && <div>Note: {ret.reason_note}</div>}
            </div>
            <div className="py-2 border-b border-black space-y-1.5">
              {ret.items.map((it, i) => (
                <div key={i}>
                  <div className="font-semibold truncate">{it.name_fr}</div>
                  <div className="flex justify-between text-[10px]">
                    <span>{qtyLabel(it.qty_milli, it.unit)}</span>
                    <span className="font-bold">{formatDZDFromCt(it.line_ttc_ct)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="py-2 border-b border-black font-bold text-[12px] flex justify-between">
              <span>REMBOURSE:</span><span>{formatDZDFromCt(ret.refund_ct)}</span>
            </div>
            <div className="py-2 text-[10px] space-y-0.5">
              <div>Cree par: {ret.actor}</div>
              <div>Approuve par: {ret.approver}</div>
            </div>
            <div className="pt-3 space-y-4 text-[10px]">
              <div>Signature Client: ........................</div>
              <div>Signature Caissier: ......................</div>
              <div className="text-center">Timbre non remboursable</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
