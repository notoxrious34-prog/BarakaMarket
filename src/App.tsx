import React, { useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { PosView } from './components/POS/PosView';
import { ProductsStockView } from './components/Inventory/ProductsStockView';
import { CarnetDetteView } from './components/Clients/CarnetDetteView';
import { DailyZReportView } from './components/Reports/DailyZReportView';
import { LicenseManagerView } from './components/License/LicenseManagerView';
import { StoreProfileView } from './components/Settings/StoreProfileView';
import { SuppliersPurchasesView } from './components/Suppliers/SuppliersPurchasesView';
import { AccountingJournalView } from './components/Accounting/AccountingJournalView';
import { TicketThermal80mm } from './components/Receipts/TicketThermal80mm';
import { FactureReglementaireA4 } from './components/Receipts/FactureReglementaireA4';

const MainLayout: React.FC = () => {
  const {
    activeView,
    setActiveView,
    toggleLanguage,
    currentPrintSale,
    printModalType,
    closePrintModal,
    language,
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
        {activeView === 'license' && <LicenseManagerView />}
        {activeView === 'settings' && <StoreProfileView />}
      </main>

      {/* Slim status bar: cashier • version • local DB (fiscal IDs live on receipts + settings) */}
      <footer className="px-4 py-1 bg-[#070a0f] border-t border-[#162030] text-[10px] text-slate-500 flex items-center justify-between gap-2 select-none">
        <span>
          {language === 'ar' ? 'الكاشير:' : 'Caissier:'}{' '}
          <span className="text-slate-300 font-medium">Amine (Caisse 01)</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            WAL
          </span>
          <span className="text-slate-600">|</span>
          <span className="uppercase tracking-widest text-amber-400/80">v1.0-rc1</span>
        </span>
      </footer>

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
