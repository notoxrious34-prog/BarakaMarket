import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { PaymentMethod } from '../../types';
import { calculateSaleTotals } from '../../core/cart-bridge';
import { formatDZD } from '../../core/display';
import { formatDZDFromCentimes, dzdToCentimes } from '../../core/money';
import { calculateCashChange, smartCashPresetsCt } from '../../core/fiscal.centimes';
import { resolveAction } from '../../core/shortcuts';
import { touchAmountKey } from '../../core/touch-amount';
import { Key, KeyPad } from '../ui/KeyPad';
import { cashChime } from '../../hardware/sound';
import { kickDrawerViaLoopback } from '../../core/fiscal-authority';
import { showPoleTotal } from '../../core/print-lane';
import {
  Banknote,
  CreditCard,
  BookOpen,
  CheckCircle,
  X,
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
    completeSaleFiscal,
    isFiscalMode,
    isTrialExpired,
    storeProfile,
    language,
  } = useApp();

  const isAr = language === 'ar';

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ESPECES');
  const [isFactureReglementaire, setIsFactureReglementaire] = useState(false);
  // ADR-005-MKT: post-validation Change HUD (giant change, scanner dismisses).
  const [hudChangeCt, setHudChangeCt] = useState<number | null>(null);

  // Compute totals based on currently chosen payment method
  const totals = calculateSaleTotals(currentCart, paymentMethod, storeProfile);
  const totalTtcCt = dzdToCentimes(totals.total_ttc);

  // Tendered input is Dinars text; converted to centimes once via dzdToCentimes.
  const [amountPaidInput, setAmountPaidInput] = useState<string>(totals.total_ttc.toString());
  const tenderInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    tenderInputRef.current?.focus();
    tenderInputRef.current?.select();
    // T5 (ADR-028): customer pole shows the amount due on modal open.
    // Fire-and-forget: pole absent => Lane B (voice + screen) stays the path.
    void showPoleTotal(totals.total_ttc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update amount paid default when payment method or totals change
  useEffect(() => {
    setAmountPaidInput(totals.total_ttc.toString());
  }, [paymentMethod, totals.total_ttc]);

  const tenderedCt = amountPaidInput.trim() === '' ? 0 : dzdToCentimes(parseFloat(amountPaidInput) || 0);
  const change = calculateCashChange(totalTtcCt, tenderedCt);
  const isUnderpaid = paymentMethod === 'ESPECES' && !change.isValid;
  const presetsCt = smartCashPresetsCt(totalTtcCt);

  // Credit limit check
  const isCreditExceeded =
    paymentMethod === 'CREDIT' &&
    selectedClient.max_credit_limit > 0 &&
    selectedClient.credit_balance + totals.total_ttc > selectedClient.max_credit_limit;

  const finalizeWith = async (tenderCt: number) => {
    if (isTrialExpired) {
      alert(isAr ? 'انتهت الفترة التجريبية. يرجى تفعيل البرنامج.' : "Essai terminé — activez la licence pour encaisser.");
      return;
    }
    if (paymentMethod === 'CREDIT' && selectedClient.id === 1) {
      alert(isAr ? 'يرجى اختيار عميل من دفتر الديون لتسجيل البيع بالكريدي' : 'Veuillez sélectionner un client pour le crédit');
      return;
    }

    // Gate-02 TASK 1: authoritative SQLite commit in fiscal mode (monotonic
    // FACT/T); provisional fallback keeps the rush-hour line moving.
    const paidDzd = tenderCt / 100;
    if (isFiscalMode) {
      await completeSaleFiscal(paymentMethod, paidDzd, isFactureReglementaire);
    } else {
      completeSale(paymentMethod, paidDzd, isFactureReglementaire);
    }
    // Gate-02 TASK 2+4 + ADR-005: drawer kick on cash + acoustic seal + HUD.
    if (paymentMethod === 'ESPECES') {
      kickDrawerViaLoopback();
      setHudChangeCt(calculateCashChange(totalTtcCt, tenderCt).changeCt);
    }
    cashChime();
    if (paymentMethod !== 'ESPECES') onClose();
  };

  const handleValidate = async () => {
    if (isUnderpaid) return;
    // Empty tendered field = exact amount (rush-hour express lane).
    const tenderCt = amountPaidInput.trim() === '' ? totalTtcCt : tenderedCt;
    await finalizeWith(tenderCt);
  };

  const setExact = () => setAmountPaidInput((totalTtcCt / 100).toString());

  // ADR-005-MKT keyboard matrix (capture phase: pre-empts the POS F1-F4 layer).
  // C5: pay-lane matching via the customizable registry; Enter/Escape/2/3
  // stay structural cockpit keys (not remappable).
  useEffect(() => {
    if (hudChangeCt !== null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement).tagName === 'INPUT';
      const payAction = resolveAction(e, localStorage, 'pay');
      if (payAction === 'pay.exact') {
        e.preventDefault(); e.stopPropagation(); setExact(); return;
      }
      if (payAction === 'pay.1000') {
        e.preventDefault(); e.stopPropagation(); setAmountPaidInput('1000'); return;
      }
      if (payAction === 'pay.2000') {
        e.preventDefault(); e.stopPropagation(); setAmountPaidInput('2000'); return;
      }
      if (payAction === 'pay.5000') {
        e.preventDefault(); e.stopPropagation(); setAmountPaidInput('5000'); return;
      }
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); onClose(); return;
      }
      if (e.key === 'Enter') {
        const c = calculateCashChange(totalTtcCt, amountPaidInput.trim() === '' ? totalTtcCt : dzdToCentimes(parseFloat(amountPaidInput) || 0));
        if (!c.isValid && paymentMethod === 'ESPECES') return;
        e.preventDefault(); e.stopPropagation();
        void handleValidate(); return;
      }
      if (!inInput && (e.key === '2' || e.key === '3')) {
        if (e.key === '2') setPaymentMethod('DAHABIYA');
        if (e.key === '3') setPaymentMethod('CREDIT');
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountPaidInput, totalTtcCt, paymentMethod, isFiscalMode, hudChangeCt, isAr]);

  // ADR-005-MKT: HUD dismissal — Enter/Space/Escape, any scanner char, or click
  // ends the splash, closes the cockpit and re-arms the barcode input.
  useEffect(() => {
    if (hudChangeCt === null) return;
    const dismiss = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape' || e.key.length === 1) {
        e.preventDefault(); e.stopPropagation();
        setHudChangeCt(null);
        onClose();
      }
    };
    window.addEventListener('keydown', dismiss, true);
    return () => window.removeEventListener('keydown', dismiss, true);
  }, [hudChangeCt, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className={`bg-[#111722] border border-[#1e293b] rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col ${paymentMethod === 'ESPECES' ? 'max-w-2xl' : 'max-w-md'}`}>
        {/* Modal Header — slim band, gold hairline */}
        <div className="px-4 py-2.5 border-b border-amber-500/20 flex items-center justify-between bg-[#0b0f17]">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Banknote className="w-4 h-4 text-amber-300" />
              <span>{isAr ? 'الدفع في الصندوق / Règlement Caisse' : 'Règlement Caisse / الدفع في الصندوق'}</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              {currentCart.length} {isAr
                ? (currentCart.length === 1 ? 'منتج واحد في السلة' : 'منتجات في السلة')
                : (currentCart.length === 1 ? 'article dans le panier' : 'articles dans le panier')} · F1 exact · F2 1000 · F3 2000 · F4 5000
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-[#162030] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-3">
          {/* Payment Method Selector */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 block mb-1">
              {isAr ? 'طريقة الدفع' : 'Mode de Règlement'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('ESPECES')}
                className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  paymentMethod === 'ESPECES'
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-md shadow-emerald-950/40'
                    : 'bg-[#162030] border-[#2b3a4f] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Banknote className="w-4 h-4 text-emerald-400" />
                <span className="text-[11px] font-bold">{isAr ? 'نقداً / Espèces' : 'Espèces / نقداً'}</span>
                <span className="text-[10px] text-amber-300/80 font-mono">+1% Timbre</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('DAHABIYA')}
                className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  paymentMethod === 'DAHABIYA' || paymentMethod === 'CIB'
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-md shadow-emerald-950/40'
                    : 'bg-[#162030] border-[#2b3a4f] text-slate-400 hover:text-slate-200'
                }`}
              >
                <CreditCard className="w-4 h-4 text-amber-400" />
                <span className="text-[11px] font-bold">{isAr ? 'ذهبية / CIB' : 'CIB / Dahabiya'}</span>
                <span className="text-[10px] text-emerald-400/80 font-mono">Exempt Timbre</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CREDIT')}
                className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  paymentMethod === 'CREDIT'
                    ? 'bg-rose-950/70 border-rose-500 text-white shadow-md shadow-rose-950/40'
                    : 'bg-[#162030] border-[#2b3a4f] text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-4 h-4 text-rose-400" />
                <span className="text-[11px] font-bold">{isAr ? 'كريدي (دَيْن)' : 'Carnet Crédit'}</span>
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

          {/* Amount ticket — flat micro-ledger, gold NET band */}
          <div className="bg-[#0b0f17] border border-[#1e293b] rounded-xl px-3 py-2 space-y-1">
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>{isAr ? 'المجموع (HT)' : 'Total HT'}</span>
              <span className="font-mono" dir="ltr">{formatDZD(totals.total_ht)}</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>{isAr ? 'TVA (0% · 9% · 19%)' : 'TVA (0% · 9% · 19%)'}</span>
              <span className="font-mono" dir="ltr">{formatDZD(totals.total_tva)}</span>
            </div>

            {paymentMethod === 'ESPECES' && (
              <div className="flex justify-between text-[11px] text-amber-300/90 font-medium ps-2 border-s border-amber-500/60">
                <span>{isAr ? 'الطابع (1%) — أدنى 10 دج' : 'Timbre 1% — min 10 DA'}</span>
                <span className="font-mono" dir="ltr">+{formatDZD(totals.timbre_fiscal)}</span>
              </div>
            )}

            <div className="pt-1.5 mt-1 border-t border-amber-500/25 flex justify-between items-baseline">
              <span className="text-xs font-bold text-slate-200">
                {isAr ? 'الصافي المستحق TTC' : 'NET À PAYER TTC'}
              </span>
              <span className="text-xl font-black text-amber-300 font-mono tabular-nums" dir="ltr">
                {formatDZD(totals.total_ttc, false)}
              </span>
            </div>
          </div>

          {/* Cash cockpit: keypad RIGHT (first in RTL) in a raised tray,
              tender column alongside. Compact touch caps (~48px). */}
          {paymentMethod === 'ESPECES' && (
            <div className="grid gap-3 md:grid-cols-[1fr_200px]">
              <div className="bg-[#0d1420] border border-[#1e293b] rounded-xl p-2">
                <KeyPad>
                  {(['1','2','3','4','5','6','7','8','9','00','0','.'] as const).map(k => (
                    <Key key={k} onPress={() => setAmountPaidInput(v => touchAmountKey(v, k))} label={k} />
                  ))}
                  <Key variant="danger" onPress={() => setAmountPaidInput(v => touchAmountKey(v, 'C'))} label="C" title={isAr ? 'مسح' : 'Effacer'} />
                  <Key variant="ok" onPress={() => setExact()} label={isAr ? 'بالضبط' : 'Exact'} />
                  <Key variant="muted" onPress={() => setAmountPaidInput(v => touchAmountKey(v, 'back'))} label="⌫" title={isAr ? 'تراجع' : 'Retour'} />
                </KeyPad>
              </div>

              <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest text-slate-500">
                  {isAr ? 'المستلم' : 'Reçu'}
                </label>
              </div>

              <input
                ref={tenderInputRef}
                type="number"
                value={amountPaidInput}
                onChange={e => setAmountPaidInput(e.target.value)}
                className="w-full bg-[#162030] border border-[#2b3a4f] focus:border-emerald-500 text-white font-mono text-lg font-bold px-3 py-1.5 rounded-xl text-center outline-none"
              />

              {/* Algerian note preset chips */}
              <div className="flex flex-wrap gap-1">
                <button
                  key="exact"
                  type="button"
                  onClick={setExact}
                  title="F1"
                  className="flex-1 py-1 px-1.5 bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 rounded-lg text-[11px] font-mono font-bold border border-emerald-700 cursor-pointer whitespace-nowrap"
                >
                  {isAr ? 'بالضبط' : 'Exact'}
                </button>
                {presetsCt.filter(p => p !== totalTtcCt).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setAmountPaidInput((p / 100).toString())}
                    className="flex-1 py-1 px-1.5 bg-[#162030] hover:bg-[#233145] text-slate-300 hover:text-white rounded-lg text-[11px] font-mono font-semibold border border-[#2b3a4f] cursor-pointer whitespace-nowrap"
                  >
                    {(p / 100).toLocaleString('fr-DZ')}
                  </button>
                ))}
              </div>

              {/* Live change / deficit indicator */}
              {change.isValid ? (
                <div className="bg-emerald-950/60 border border-emerald-600/70 rounded-xl px-3 py-1.5 text-center shadow-[0_0_18px_-6px_rgba(16,185,129,0.5)]">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/80">
                    {isAr ? 'الصرف' : 'Rendu'}
                  </p>
                  <p className="font-mono font-black text-emerald-300 text-3xl tabular-nums leading-tight" dir="ltr">
                    {formatDZDFromCentimes(change.changeCt, false)}
                  </p>
                </div>
              ) : (
                <div className="bg-rose-950/40 border border-rose-800 rounded-xl px-3 py-1.5 text-center">
                  <p className="text-[11px] font-bold text-rose-300">
                    {isAr ? `ناقص: ${formatDZDFromCentimes(change.deficitCt, false)}` : `Manque: ${formatDZDFromCentimes(change.deficitCt, false)}`}
                  </p>
                </div>
              )}
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
        <div className="px-4 py-2.5 bg-[#0b0f17] border-t border-[#1e293b] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-[#162030] hover:bg-[#1e293b] text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
          >
            {isAr ? 'إلغاء' : 'Annuler'}
          </button>

          <button
            type="button"
            onClick={handleValidate}
            disabled={isUnderpaid || (paymentMethod === 'CREDIT' && selectedClient.id === 1)}
            className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-[13px] font-bold shadow-lg shadow-emerald-950/60 flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{isAr ? 'تأكيد وطباعة (Enter)' : 'Valider & Imprimer (Enter)'}</span>
          </button>
        </div>
      </div>

      {/* ADR-005-MKT: post-validation Change HUD — scanner/Enter/Space/Esc dismiss */}
      {hudChangeCt !== null && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          onClick={() => { setHudChangeCt(null); onClose(); }}
          role="alertdialog"
          aria-modal="true"
        >
          <div className="text-center space-y-3 max-w-lg">
            <p className="flex items-center justify-center gap-2 text-emerald-300 font-bold text-lg">
              <CheckCircle className="w-6 h-6" />
              {isAr ? 'تم البيع / VENTE ENREGISTRÉE' : 'VENTE ENREGISTRÉE / تم البيع'}
            </p>
            <p className="text-slate-300 text-sm font-bold">
              {isAr ? 'الباقي / À RENDRE:' : 'À RENDRE / الباقي:'}
            </p>
            <p className="font-mono font-black text-emerald-300 tabular-nums leading-none text-6xl" dir="ltr">
              {formatDZDFromCentimes(hudChangeCt, false)}
            </p>
            <p className="text-xs text-slate-400">
              {isAr ? 'امسح المنتج التالي أو اضغط Enter للزبون الموالي' : 'Scannez l’article suivant ou Enter pour le client suivant'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
