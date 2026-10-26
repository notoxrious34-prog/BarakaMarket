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
