import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PaymentMethod } from '../../types';
import { calculateSaleTotals, formatDZD } from '../../utils/fiscal';
import {
  Banknote,
  CreditCard,
  BookOpen,
  CheckCircle,
  X,
  FileText,
  Printer,
  AlertTriangle,
} from 'lucide-react';

interface PaymentModalProps {
  onClose: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({ onClose }) => {
  const {
    currentCart,
    selectedClient,
    clients,
    setSelectedClient,
    completeSale,
    storeProfile,
    language,
  } = useApp();

  const isAr = language === 'ar';

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ESPECES');
  const [isFactureReglementaire, setIsFactureReglementaire] = useState(false);

  // Compute totals based on currently chosen payment method
  const totals = calculateSaleTotals(currentCart, paymentMethod, storeProfile);

  const [amountPaidInput, setAmountPaidInput] = useState<string>(totals.total_ttc.toString());

  // Update amount paid default when payment method or totals change
  useEffect(() => {
    if (paymentMethod === 'ESPECES') {
      setAmountPaidInput(totals.total_ttc.toString());
    } else {
      setAmountPaidInput(totals.total_ttc.toString());
    }
  }, [paymentMethod, totals.total_ttc]);

  const numPaid = parseFloat(amountPaidInput) || 0;
  const changeDue = Math.max(0, numPaid - totals.total_ttc);
  const isUnderpaid = paymentMethod === 'ESPECES' && numPaid < totals.total_ttc;

  // Credit limit check
  const isCreditExceeded =
    paymentMethod === 'CREDIT' &&
    selectedClient.max_credit_limit > 0 &&
    selectedClient.credit_balance + totals.total_ttc > selectedClient.max_credit_limit;

  const handleValidate = () => {
    if (isUnderpaid) return;
    if (paymentMethod === 'CREDIT' && selectedClient.id === 1) {
      alert(isAr ? 'يرجى اختيار عميل من دفتر الديون لتسجيل البيع بالكريدي' : 'Veuillez sélectionner un client pour le crédit');
      return;
    }

    completeSale(paymentMethod, numPaid, isFactureReglementaire);
    onClose();
  };

  // Keyboard shortcut: Enter to submit, Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && !isUnderpaid) {
        e.preventDefault();
        handleValidate();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [numPaid, isUnderpaid, paymentMethod]);

  const quickDenominations = [
    totals.total_ttc,
    Math.ceil(totals.total_ttc / 500) * 500,
    1000,
    2000,
    4000,
    5000,
  ].filter((v, i, arr) => v >= totals.total_ttc && arr.indexOf(v) === i);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between bg-[#0b0f17]">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Banknote className="w-5 h-5 text-emerald-400" />
              <span>{isAr ? 'إتمام الدفع واستخراج الوصل' : 'Encaissement & Règlement'}</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {currentCart.length} {isAr ? 'منتجات في السلة' : 'articles dans le panier'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-[#162030] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {/* Payment Method Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              {isAr ? 'طريقة الدفع:' : 'Mode de Règlement:'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('ESPECES')}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'ESPECES'
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-md shadow-emerald-950/40'
                    : 'bg-[#162030] border-[#2b3a4f] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Banknote className="w-5 h-5 text-emerald-400" />
                <span className="text-xs font-bold">{isAr ? 'نقداً (Espèces)' : 'Espèces'}</span>
                <span className="text-[10px] text-amber-300/80 font-mono">+1% Timbre</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('DAHABIYA')}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'DAHABIYA' || paymentMethod === 'CIB'
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-md shadow-emerald-950/40'
                    : 'bg-[#162030] border-[#2b3a4f] text-slate-400 hover:text-slate-200'
                }`}
              >
                <CreditCard className="w-5 h-5 text-amber-400" />
                <span className="text-xs font-bold">{isAr ? 'ذهبية / CIB' : 'CIB / Dahabiya'}</span>
                <span className="text-[10px] text-emerald-400/80 font-mono">Exempt Timbre</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CREDIT')}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                  paymentMethod === 'CREDIT'
                    ? 'bg-rose-950/70 border-rose-500 text-white shadow-md shadow-rose-950/40'
                    : 'bg-[#162030] border-[#2b3a4f] text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-5 h-5 text-rose-400" />
                <span className="text-xs font-bold">{isAr ? 'كريدي (دَيْن)' : 'Carnet Crédit'}</span>
                <span className="text-[10px] text-slate-400 font-mono">Sur Compte</span>
              </button>
            </div>
          </div>

          {/* If Credit selected, verify Client */}
          {paymentMethod === 'CREDIT' && (
            <div className="bg-[#162030] border border-[#2b3a4f] rounded-xl p-3 space-y-2">
              <label htmlFor="credit-client-selector" className="text-xs font-semibold text-amber-300 block">
                {isAr ? 'اختر حساب العميل من دفتر الديون:' : 'Compte Client Crédit:'}
              </label>
              <select
                id="credit-client-selector"
                value={selectedClient.id}
                onChange={e => {
                  const id = parseInt(e.target.value, 10);
                  const cl = clients.find(c => c.id === id);
                  if (cl) setSelectedClient(cl);
                }}
                className="w-full bg-[#111722] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white"
              >
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.id !== 1 ? `(Dette: ${formatDZD(c.credit_balance, false)})` : '(Non autorisé)'}
                  </option>
                ))}
              </select>

              {selectedClient.id === 1 && (
                <p className="text-[11px] text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{isAr ? 'لا يمكن البيع بالكريدي للزبون المجهول (Passager)' : 'Sélectionnez un client nommé pour le carnet de dette.'}</span>
                </p>
              )}

              {isCreditExceeded && (
                <p className="text-[11px] text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>
                    {isAr
                      ? `تحذير: سيتم تجاوز الحد الائتماني المسموح (${formatDZD(selectedClient.max_credit_limit, false)})`
                      : `Attention: Dépassement du plafond autorisé (${formatDZD(selectedClient.max_credit_limit, false)})`}
                  </span>
                </p>
              )}
            </div>
          )}

          {/* Amount Breakdown Panel */}
          <div className="bg-[#0b0f17] border border-[#1e293b] rounded-xl p-3.5 space-y-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span>{isAr ? 'المجموع بدون ضرائب (HT):' : 'Sous-total HT:'}</span>
              <span className="font-mono text-slate-300" dir="ltr">{formatDZD(totals.total_ht)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>{isAr ? 'مجموع الرسم على القيمة المضافة (TVA):' : 'Total TVA (0%, 9%, 19%):'}</span>
              <span className="font-mono text-slate-300" dir="ltr">{formatDZD(totals.total_tva)}</span>
            </div>

            {paymentMethod === 'ESPECES' && (
              <div className="flex justify-between text-xs text-amber-300/90 font-medium ps-2 border-s-2 border-amber-500">
                <span>{isAr ? 'حق الطابع المالي (المادة 136 قانون الطابع):' : 'Droit de Timbre Fiscal (1% Espèces):'}</span>
                <span className="font-mono" dir="ltr">+{formatDZD(totals.timbre_fiscal)}</span>
              </div>
            )}

            <div className="pt-2 border-t border-[#1e293b] flex justify-between items-baseline">
              <span className="text-sm font-bold text-white">
                {isAr ? 'المجموع المستحق (TTC):' : 'NET À PAYER TTC:'}
              </span>
              <span className="text-2xl font-black text-emerald-400 font-mono" dir="ltr">
                {formatDZD(totals.total_ttc, false)}
              </span>
            </div>
          </div>

          {/* Cash Handling: Amount Tendered & Change */}
          {paymentMethod === 'ESPECES' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">
                  {isAr ? 'المبلغ المستلم من الزبون:' : 'Montant Reçu / Versé (DZD):'}
                </label>
                {changeDue > 0 && (
                  <span className="text-xs font-bold text-emerald-400">
                    {isAr ? 'الباقي المردود للزبون:' : 'Rendu Monnaie:'}{' '}
                    <strong className="text-sm font-mono">{formatDZD(changeDue, false)}</strong>
                  </span>
                )}
              </div>

              <input
                type="number"
                value={amountPaidInput}
                onChange={e => setAmountPaidInput(e.target.value)}
                className="w-full bg-[#162030] border border-[#2b3a4f] focus:border-emerald-500 text-white font-mono text-xl font-bold px-3 py-2 rounded-xl text-center outline-none"
              />

              {/* Quick Cash Buttons */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {quickDenominations.map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmountPaidInput(val.toString())}
                    className="flex-1 py-1 px-2 bg-[#162030] hover:bg-[#233145] text-slate-300 hover:text-white rounded-lg text-xs font-mono font-semibold border border-[#2b3a4f] cursor-pointer"
                  >
                    {val} DZD
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Document Type Toggle: Ticket de Caisse vs Facture A4 */}
          <div className="pt-2 border-t border-[#1e293b] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="facture-checkbox"
                checked={isFactureReglementaire}
                onChange={e => setIsFactureReglementaire(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 bg-[#162030] border-[#2b3a4f] cursor-pointer"
              />
              <label htmlFor="facture-checkbox" className="text-xs text-slate-300 cursor-pointer">
                {isAr
                  ? 'إصدار فاتورة قانونية تجارية رسمية (Format A4 Entreprise)'
                  : 'Éditer Facture Réglementaire Officielle (Format A4)'}
              </label>
            </div>
            <span className="text-[10px] text-slate-500">
              {isFactureReglementaire ? 'A4 PDF/Print' : '80mm Thermique'}
            </span>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#0b0f17] border-t border-[#1e293b] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#162030] hover:bg-[#1e293b] text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
          >
            {isAr ? 'إلغاء' : 'Annuler'}
          </button>

          <button
            type="button"
            onClick={handleValidate}
            disabled={isUnderpaid || (paymentMethod === 'CREDIT' && selectedClient.id === 1)}
            className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-950/60 flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{isAr ? 'تأكيد وطباعة (Enter)' : 'Valider & Imprimer (Enter)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
