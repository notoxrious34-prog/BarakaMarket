import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { APP_VERSION } from './core/version';
import { can } from './core/rbac';
import { Navbar } from './components/Navbar';
import { PosView } from './components/POS/PosView';
import { ProductsStockView } from './components/Inventory/ProductsStockView';
import { CarnetDetteView } from './components/Clients/CarnetDetteView';
import { DailyZReportView } from './components/Reports/DailyZReportView';
import { LicenseManagerView } from './components/License/LicenseManagerView';
import { LoginScreen } from './components/Session/LoginScreen';
import { SettingsView } from './components/Settings/SettingsView';
import { SuppliersPurchasesView } from './components/Suppliers/SuppliersPurchasesView';
import { CashSessionsView } from './components/Cash/CashSessionsView';
import { AccountingJournalView } from './components/Accounting/AccountingJournalView';
import { TicketThermal80mm } from './components/Receipts/TicketThermal80mm';
import { FactureReglementaireA4 } from './components/Receipts/FactureReglementaireA4';
import { SettlementQuittanceTicket } from './components/Receipts/SettlementQuittanceTicket';
import { StoreProfileSetupModal } from './components/Settings/StoreProfileSetupModal';

const MainLayout: React.FC = () => {
  const {
    activeView,
    setActiveView,
    toggleLanguage,
    currentPrintSale,
    printModalType,
    closePrintModal,
    lastSettlementQuittance,
    language,
    needsStoreSetup,
    isFiscalMode,
    session,
    sessionLocked,
    outboxPending,
    retryOutboxDrain,
    outboxFailed,
    outboxEntries,
    refreshOutbox,
    discardOutboxEntry,
  } = useApp();
  const [outboxOpen, setOutboxOpen] = useState(false);

  // Global hotkeys: Ctrl+L to toggle language
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        toggleLanguage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleLanguage]);

  // Owner order 2026-11-03: manual lock only. A locked session renders as an
  // OVERLAY above the live shop — the POS tree never unmounts, so carts,
  // modals and drafts survive the lock/unlock cycle.
  if (!session) return <LoginScreen />;

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-sans select-none antialiased">
      <Navbar />

      <main className="flex-1 flex flex-col overflow-hidden">
        {activeView === 'pos' && <PosView />}
        {activeView === 'products' && <ProductsStockView />}
        {activeView === 'suppliers' && <SuppliersPurchasesView />}
        {activeView === 'clients' && <CarnetDetteView />}
        {activeView === 'accounting' && <AccountingJournalView />}
        {activeView === 'reports' && <DailyZReportView />}
        {activeView === 'shifts' && <CashSessionsView />}
        {activeView === 'license' && <LicenseManagerView />}
        {activeView === 'settings' && <SettingsView />}
      </main>

      {/* Slim status bar: cashier • version • local DB (fiscal IDs live on receipts + settings) */}
      <footer className="px-4 py-1 bg-slate-100 dark:bg-[#070a0f] border-t border-slate-200 dark:border-[#162030] text-[10px] text-slate-600 dark:text-slate-500 flex items-center justify-between gap-2 flex-wrap select-none transition-colors">
        <span className="min-w-0 truncate">
          {language === 'ar' ? 'الكاشير:' : 'Caissier:'}{' '}
          <span className="text-slate-800 dark:text-slate-300 font-medium">
            {session ? `${session.displayName} (${session.role})` : '—'}
          </span>
        </span>
        <span className="flex items-center gap-2 min-w-0 flex-wrap justify-end">
          {outboxPending > 0 && (
            <span className="relative">
              <button
                type="button"
                onClick={() => { refreshOutbox(); setOutboxOpen(o => !o); }}
                title={outboxFailed
                  ? (language === 'ar' ? 'تعذّر الإرسال — الخادم لا يستجيب. انقر للفحص وإعادة المحاولة' : "Échec d'envoi — serveur injoignable. Cliquer pour inspecter")
                  : (language === 'ar' ? 'عمليات بانتظار الإرسال للقاعدة — انقر للفحص وإعادة المحاولة' : 'Opérations en attente — cliquer pour inspecter')}
                className={outboxFailed
                  ? 'flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-400/60 text-red-300 font-semibold cursor-pointer hover:bg-red-500/25'
                  : 'flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/50 text-amber-300 font-semibold cursor-pointer hover:bg-amber-500/25'}
              >
                <span className={`w-1.5 h-1.5 rounded-full inline-block animate-pulse ${outboxFailed ? 'bg-red-400' : 'bg-amber-400'}`} />
                {language === 'ar'
                  ? (outboxFailed ? `تعذّر إرسال ${outboxPending}` : `${outboxPending} بانتظار الإرسال`)
                  : (outboxFailed ? `Échec × ${outboxPending}` : `${outboxPending} en attente`)}
              </button>
              {outboxOpen && (
                <div className="absolute bottom-7 start-0 z-50 w-80 max-h-72 overflow-auto rounded-lg border border-amber-400/40 bg-[#0d1320] p-2 shadow-2xl text-xs">
                  <div className="px-1 pb-1.5 font-bold text-amber-200">
                    {language === 'ar' ? 'الطابور الصادر — عمليات لم تصل القاعدة' : 'File sortante — opérations non reçues'}
                  </div>
                  {outboxEntries.map(e => (
                    <div key={e.key} className="mb-1.5 rounded border border-white/10 bg-white/5 p-1.5">
                      <div className="flex justify-between font-mono">
                        <span className="text-sky-300">{e.provisionalId}</span>
                        <span className="text-white/50">{e.kind === 'settlement' ? 'Q' : 'T'} · ×{e.attempts}</span>
                      </div>
                      <div className="text-white/40 font-mono truncate" dir="ltr" title={e.key}>{e.key.slice(0, 8)}… · {new Date(e.enqueuedAt).toLocaleString()}</div>
                      {e.lastError && (
                        <div className="mt-0.5 break-words text-[11px] leading-snug text-red-300/90" dir="auto" title={e.lastError}>
                          ⚠ {e.lastError.length > 140 ? `${e.lastError.slice(0, 140)}…` : e.lastError}
                        </div>
                      )}
                      <div className="mt-1 flex gap-1">
                        <button
                          type="button"
                          onClick={() => retryOutboxDrain()}
                          className="flex-1 rounded bg-amber-500/20 border border-amber-400/40 px-1 py-0.5 text-amber-200 hover:bg-amber-500/30"
                        >
                          {language === 'ar' ? 'إعادة المحاولة' : 'Réessayer'}
                        </button>
                        {session && can(session.role, 'users.manage') && (
                          <button
                            type="button"
                            onClick={() => {
                              const ok = window.confirm(language === 'ar'
                                ? `تجاهل ${e.provisionalId} نهائياً؟ تُسجَّل في التدقيق ولا تصل القاعدة أبداً.`
                                : `Ignorer ${e.provisionalId} définitivement ? Tracé en audit, jamais transmis.`);
                              if (ok) discardOutboxEntry(e.key);
                            }}
                            className="rounded bg-red-500/20 border border-red-400/40 px-2 py-0.5 text-red-200 hover:bg-red-500/30"
                          >
                            {language === 'ar' ? 'تجاهل' : 'Ignorer'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
          {isFiscalMode ? (
            <span className="flex items-center gap-1 text-emerald-400 font-semibold whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              <span className="hidden min-[900px]:inline">● REGISTRE FISCAL ACTIF (SQLITE WAL)</span>
              <span className="min-[900px]:hidden">● FISCAL</span>
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                WAL
              </span>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <span className="text-amber-400/90 font-semibold">PROVISOIRE</span>
            </>
          )}
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span className="uppercase tracking-widest text-amber-400/80">V{APP_VERSION}</span>
        </span>
      </footer>

      {/* Gate-03 TASK 4: first-run identity lock — blocks the POS until saved. */}
      {needsStoreSetup && <StoreProfileSetupModal />}

      {/* Direct Thermal Receipt (80mm) Print Modal */}
      {printModalType === 'ticket' && currentPrintSale && (
        <TicketThermal80mm
          sale={currentPrintSale}
          onClose={closePrintModal}
        />
      )}

      {/* Official Algerian Commercial Invoice (A4) Print Modal */}
      {printModalType === 'facture' && currentPrintSale && (
        <FactureReglementaireA4
          sale={currentPrintSale}
          onClose={closePrintModal}
        />
      )}

      {/* Debt settlement quittance (Art.136) — auto-opened on settleClientDebt */}
      {lastSettlementQuittance && <SettlementQuittanceTicket />}

      {/* Owner order 2026-11-03: manual lock renders ABOVE the live shop.
          The tree stays mounted — carts, modals and drafts survive. */}
      {sessionLocked && session && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/70 backdrop-blur-[2px]">
          <LoginScreen />
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
