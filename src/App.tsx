import React, { useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { APP_VERSION } from './core/version';
import { Navbar } from './components/Navbar';
import { PosView } from './components/POS/PosView';
import { ProductsStockView } from './components/Inventory/ProductsStockView';
import { CarnetDetteView } from './components/Clients/CarnetDetteView';
import { DailyZReportView } from './components/Reports/DailyZReportView';
import { LicenseManagerView } from './components/License/LicenseManagerView';
import { LoginScreen } from './components/Session/LoginScreen';
import { UsersManagerView } from './components/Session/UsersManagerView';
import { AuditLogView } from './components/Session/AuditLogView';
import { UpdateManagerView } from './components/Settings/UpdateManagerView';
import { StoreProfileView } from './components/Settings/StoreProfileView';
import { SuppliersPurchasesView } from './components/Suppliers/SuppliersPurchasesView';
import { CashSessionsView } from './components/Cash/CashSessionsView';
import { BackupManagerView } from './components/Settings/BackupManagerView';
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
  } = useApp();

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

  // T8 (ADR-031): no session (or a locked one) = no shop. The PIN screen is
  // a full takeover — no view, no footer, no hotkey surface behind it.
  if (!session || sessionLocked) return <LoginScreen />;

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
        {activeView === 'settings' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <StoreProfileView />
            <UpdateManagerView />
            <UsersManagerView />
            <AuditLogView />
            <BackupManagerView />
          </div>
        )}
      </main>

      {/* Slim status bar: cashier • version • local DB (fiscal IDs live on receipts + settings) */}
      <footer className="px-4 py-1 bg-slate-100 dark:bg-[#070a0f] border-t border-slate-200 dark:border-[#162030] text-[10px] text-slate-600 dark:text-slate-500 flex items-center justify-between gap-2 select-none transition-colors">
        <span>
          {language === 'ar' ? 'الكاشير:' : 'Caissier:'}{' '}
          <span className="text-slate-800 dark:text-slate-300 font-medium">
            {session ? `${session.displayName} (${session.role})` : '—'}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {outboxPending > 0 && (
            <button
              type="button"
              onClick={retryOutboxDrain}
              title={outboxFailed
                ? (language === 'ar' ? 'تعذّر الإرسال — الخادم لا يستجيب. انقر لإعادة المحاولة' : "Échec d'envoi — serveur injoignable. Cliquer pour réessayer")
                : (language === 'ar' ? 'عمليات بانتظار الإرسال للقاعدة — انقر لإعادة المحاولة' : 'Opérations en attente — cliquer pour réessayer')}
              className={outboxFailed
                ? 'flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-400/60 text-red-300 font-semibold cursor-pointer hover:bg-red-500/25'
                : 'flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/50 text-amber-300 font-semibold cursor-pointer hover:bg-amber-500/25'}
            >
              <span className={`w-1.5 h-1.5 rounded-full inline-block animate-pulse ${outboxFailed ? 'bg-red-400' : 'bg-amber-400'}`} />
              {language === 'ar'
                ? (outboxFailed ? `تعذّر إرسال ${outboxPending}` : `${outboxPending} بانتظار الإرسال`)
                : (outboxFailed ? `Échec × ${outboxPending}` : `${outboxPending} en attente`)}
            </button>
          )}
          {isFiscalMode ? (
            <span className="flex items-center gap-1 text-emerald-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              ● REGISTRE FISCAL ACTIF (SQLITE WAL)
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
          <span className="uppercase tracking-widest text-amber-400/80">v{APP_VERSION}</span>
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
