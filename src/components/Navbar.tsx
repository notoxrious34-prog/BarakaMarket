import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ShoppingCart,
  Package,
  BookOpen,
  FileText,
  KeyRound,
  Settings,
  Scale,
  Languages,
  Clock,
  CheckCircle2,
  ChevronDown,
  Trash2,
  PlayCircle,
  Truck,
  PieChart,
  Sun,
  Moon,
} from 'lucide-react';
import { formatDZD } from '../utils/fiscal';

export const Navbar: React.FC = () => {
  const {
    activeView,
    setActiveView,
    language,
    toggleLanguage,
    theme,
    toggleTheme,
    heldCarts,
    restoreHeldCart,
    deleteHeldCart,
    storeProfile,
    isHardwareScaleActive,
    setHardwareScaleActive,
    scaleWeightGrams,
  } = useApp();

  const [showHeldDropdown, setShowHeldDropdown] = useState(false);

  const isAr = language === 'ar';

  return (
    <header className="bg-[#0b0f17] border-b border-[#1e293b] text-slate-200 select-none sticky top-0 z-40 transition-colors">
      {/* Top Bar: Legal mentions & Store Header */}
      <div className="px-4 py-1.5 bg-[#070a0f] border-b border-[#162030] text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-amber-400 tracking-wider">
            {storeProfile.store_name}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
            v1.0-rc1
          </span>
          <span className="text-slate-600">|</span>
          <span>RC: <strong className="text-slate-300" dir="ltr">{storeProfile.rc_number}</strong></span>
          <span className="text-slate-600">|</span>
          <span>NIF: <strong className="text-slate-300" dir="ltr">{storeProfile.nif_number}</strong></span>
          <span className="text-slate-600">|</span>
          <span>AI: <strong className="text-slate-300" dir="ltr">{storeProfile.ai_number}</strong></span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded text-[10px]">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>{isAr ? 'قاعدة بيانات محلية نشطة (WAL Mode)' : 'Base SQLite-WAL Sécurisée'}</span>
          </div>

          <div className="text-slate-400 text-[11px] flex items-center gap-1">
            <span className="text-slate-500">{isAr ? 'الكاشير:' : 'Caissier:'}</span>
            <span className="text-slate-200 font-medium">Amine (Caisse 01)</span>
          </div>
        </div>
      </div>

      {/* Main Navbar */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        {/* Brand & Logo — official Baraka (بركة) emblem tile */}
        <div
          onClick={() => setActiveView('pos')}
          className="flex items-center gap-2.5 cursor-pointer group shrink-0"
          title={isAr ? 'بركة ماركت — العودة لنقطة البيع' : 'Baraka Market — retour Caisse'}
        >
          <img
            src="/brand/baraka-emblem-256.png"
            alt="Baraka — بركة"
            className="w-9 h-9 rounded-[10px] object-cover ring-1 ring-white/10 shadow-lg shadow-black/40"
            draggable={false}
          />
          <span className="font-bold text-lg text-white tracking-tight group-hover:text-emerald-400 transition-colors whitespace-nowrap">
            Baraka Market
          </span>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveView('pos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'pos'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-[#162030] hover:text-white'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>{isAr ? 'نقطة البيع (F1)' : 'Caisse POS (F1)'}</span>
          </button>

          <button
            onClick={() => setActiveView('products')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'products'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-[#162030] hover:text-white'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>{isAr ? 'المخزون والمنتجات' : 'Stock & Produits'}</span>
          </button>

          <button
            onClick={() => setActiveView('suppliers')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'suppliers'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-[#162030] hover:text-white'
            }`}
          >
            <Truck className="w-4 h-4 text-amber-400" />
            <span>{isAr ? 'الموردين والمشتريات' : 'Fournisseurs & Achats'}</span>
          </button>

          <button
            onClick={() => setActiveView('clients')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'clients'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-[#162030] hover:text-white'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>{isAr ? 'دفتر الديون (الكريدي F9)' : 'Carnet de Dette (F9)'}</span>
          </button>

          <button
            onClick={() => setActiveView('accounting')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'accounting'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-[#162030] hover:text-white'
            }`}
          >
            <PieChart className="w-4 h-4 text-emerald-400" />
            <span>{isAr ? 'الربط المحاسبي والمصالح' : 'Comptabilité SCF'}</span>
          </button>

          <button
            onClick={() => setActiveView('reports')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'reports'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-[#162030] hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>{isAr ? 'الإغلاق الضريبي (Rapport Z)' : 'Rapport Z'}</span>
          </button>

          <button
            onClick={() => setActiveView('license')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'license'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-900/40'
                : 'text-amber-400/90 hover:bg-[#162030] hover:text-amber-300'
            }`}
          >
            <KeyRound className="w-4 h-4 text-amber-400" />
            <span>{isAr ? 'الرخصة (5000 دج)' : 'Licence'}</span>
          </button>

          <button
            onClick={() => setActiveView('settings')}
            className={`p-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeView === 'settings'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:bg-[#162030] hover:text-white'
            }`}
            title={isAr ? 'إعدادات المحل والضرائب' : 'Paramètres Store & Fiscalité'}
            aria-label={isAr ? 'إعدادات المحل والضرائب' : 'Paramètres Store & Fiscalité'}
          >
            <Settings className="w-4 h-4" />
          </button>
        </nav>

        {/* Hardware & Tools Right Bar */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Day / Night Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 bg-[#162030] hover:bg-[#1e293b] border border-[#2b3a4f] rounded-lg text-slate-300 hover:text-amber-300 transition-colors cursor-pointer"
            title={
              theme === 'dark'
                ? (isAr ? 'تفعيل الوضع النهاري (Light Mode)' : 'Activer Mode Jour')
                : (isAr ? 'تفعيل الوضع الليلي (Dark Mode)' : 'Activer Mode Nuit')
            }
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-indigo-500" />
            )}
          </button>

          {/* Held Carts Badge */}
          <div className="relative">
            <button
              onClick={() => setShowHeldDropdown(prev => !prev)}
              className="px-2.5 py-1.5 bg-[#162030] hover:bg-[#1e293b] border border-[#2b3a4f] rounded-lg text-xs text-slate-300 flex items-center gap-2 transition-colors cursor-pointer"
              title={isAr ? 'الفواتير المعلقة (F5)' : 'Paniers en attente (F5)'}
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>{isAr ? 'المعلق' : 'En Attente'}</span>
              <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-bold flex items-center justify-center border border-amber-500/30">
                {heldCarts.length}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showHeldDropdown && (
              <div className="absolute top-full mt-2 end-0 w-72 bg-[#111722] border border-[#1e293b] rounded-xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95">
                <div className="p-2 border-b border-[#1e293b] flex items-center justify-between text-xs text-slate-300">
                  <span className="font-semibold">{isAr ? 'الفواتير المعلقة' : 'Paniers en attente'}</span>
                  <span className="text-[11px] text-slate-400">{heldCarts.length} {isAr ? 'سلة' : 'paniers'}</span>
                </div>

                {heldCarts.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    {isAr ? 'لا توجد فواتير معلقة حالياً (اضغط F4 لتعليق فاتورة)' : 'Aucun panier en attente (F4 pour mettre en attente)'}
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-1.5 mt-2">
                    {heldCarts.map(h => {
                      const total = h.items.reduce((s, it) => s + it.total_line_ttc, 0);
                      return (
                        <div
                          key={h.id}
                          className="p-2 bg-[#162030] hover:bg-[#1e293b] rounded-lg flex items-center justify-between text-xs border border-[#233145]"
                        >
                          <div>
                            <div className="font-medium text-slate-200">{h.name}</div>
                            <div className="text-[10px] text-slate-400">
                              {h.items.length} {isAr ? 'عنصر' : 'art.'} • {formatDZD(total)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                restoreHeldCart(h.id);
                                setShowHeldDropdown(false);
                                setActiveView('pos');
                              }}
                              className="p-1.5 text-emerald-400 hover:bg-emerald-950/60 rounded cursor-pointer"
                              title={isAr ? 'استرجاع السلة' : 'Rappeler'}
                            >
                              <PlayCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteHeldCart(h.id)}
                              className="p-1.5 text-rose-400 hover:bg-rose-950/60 rounded cursor-pointer"
                              title={isAr ? 'حذف' : 'Supprimer'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Electronic Scale RS232 Simulator Toggle */}
          <button
            onClick={() => setHardwareScaleActive(!isHardwareScaleActive)}
            className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border transition-all cursor-pointer ${
              isHardwareScaleActive
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50'
                : 'bg-[#162030] text-slate-400 border-[#2b3a4f] hover:text-slate-200'
            }`}
            title={isAr ? 'محاكي الميزان الإلكتروني RS232' : 'Balance Électronique RS232'}
          >
            <Scale className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {isHardwareScaleActive
                ? `${(scaleWeightGrams / 1000).toFixed(3)} kg`
                : (isAr ? 'الميزان' : 'Balance')}
            </span>
          </button>

          {/* Language Switch */}
          <button
            onClick={toggleLanguage}
            className="px-2.5 py-1.5 bg-[#162030] hover:bg-[#1e293b] border border-[#2b3a4f] text-slate-300 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            title={isAr ? 'التبديل إلى الفرنسية (Ctrl+L)' : 'Basculer en Arabe (Ctrl+L)'}
          >
            <Languages className="w-3.5 h-3.5 text-amber-400" />
            <span>{isAr ? 'FR' : 'عربي'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
