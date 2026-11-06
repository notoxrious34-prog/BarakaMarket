import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { can, type Permission } from '../core/rbac';
import { RotateCcw } from 'lucide-react';
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
  ChevronDown,
  Trash2,
  PlayCircle,
  Truck,
  PieChart,
  Banknote,
  Sun,
  Moon,
  Lock,
  MoreHorizontal,
  LogOut,
} from 'lucide-react';
import { formatDZD } from '../core/display';

/** NAVBAR-REDESIGN Phase 2: shared dismiss (outside-click + Escape) for navbar menus. */
function useDismissOnOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

export const Navbar: React.FC = () => {
  const {
    activeView,
    setActiveView,
    language,
    toggleLanguage,
    theme,
    toggleTheme,
    heldCarts,
    holdCurrentCart,
    currentCart,
    restoreHeldCart,
    deleteHeldCart,
    isHardwareScaleActive,
    setHardwareScaleActive,
    scaleWeightGrams,
    session,
    logout,
    lockSession,
  } = useApp();

  const [showHeldDropdown, setShowHeldDropdown] = useState(false);
  // NAVBAR-REDESIGN Phase 2: live cashier clock (latin digits, explicit — never locale-shaped).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const dayStamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;

  const isAr = language === 'ar';

  // T8 (ADR-031): the nav shows only what the session role may touch.
  // Defense in depth — every lane re-checks server-side; hiding buttons is UX.
  const role = session?.role ?? 'cashier';
  const tabs: { view: 'pos' | 'products' | 'suppliers' | 'clients' | 'accounting' | 'reports' | 'shifts' | 'license' | 'returns'; perm: Permission; icon: React.ReactNode; label: string; title?: string; amber?: boolean }[] = [
    { view: 'pos', perm: 'sell', icon: <ShoppingCart className="w-4 h-4 flex-shrink-0" />, label: isAr ? 'الكاشير' : 'Caisse', title: isAr ? 'نقطة البيع (الكاشير)' : 'Point de vente (Caisse)' },
    { view: 'products', perm: 'products.edit', icon: <Package className="w-4 h-4" />, label: isAr ? 'المخزون' : 'Stock', title: isAr ? 'المخزون والمنتجات' : 'Stock & Produits' },
    { view: 'suppliers', perm: 'products.edit', icon: <Truck className="w-4 h-4 text-amber-400" />, label: isAr ? 'الموردون' : 'Fournisseurs', title: isAr ? 'الموردين والمشتريات' : 'Fournisseurs & Achats' },
    { view: 'clients', perm: 'settle', icon: <BookOpen className="w-4 h-4" />, label: isAr ? 'الديون (F9)' : 'Dettes (F9)', title: isAr ? 'دفتر الديون (الكريدي F9)' : 'Carnet de Dette (F9)' },
    { view: 'returns', perm: 'returns.create', icon: <RotateCcw className="w-4 h-4 text-amber-400" />, label: isAr ? 'الإرجاع' : 'Retours', title: isAr ? 'إرجاع سلعة (مسودة ← قرار ← وصل)' : 'Retour marchandise' },
    { view: 'accounting', perm: 'accounting.view', icon: <PieChart className="w-4 h-4 text-emerald-400" />, label: isAr ? 'المحاسبة' : 'Compta', title: isAr ? 'الربط المحاسبي والمصالح' : 'Comptabilité SCF' },
    { view: 'reports', perm: 'accounting.view', icon: <FileText className="w-4 h-4" />, label: isAr ? 'تقرير Z' : 'Rapport Z', title: isAr ? 'تقرير Z اليومي' : 'Rapport Z journalier' },
    { view: 'shifts', perm: 'z.close', icon: <Banknote className="w-4 h-4 text-amber-400" />, label: isAr ? 'إغلاق' : 'Clôture', title: isAr ? 'إغلاق الصندوق وتقرير Z' : 'Caisse & Clôture / Z' },
    { view: 'license', perm: 'settings.edit', icon: <KeyRound className="w-4 h-4 text-amber-400" />, label: isAr ? 'الرخصة' : 'Licence', amber: true, title: isAr ? 'رخصة تفعيل المحل' : "Licence d'activation" },
  ];
  const visibleTabs = tabs.filter(t => can(role, t.perm));
  const showSettings = can(role, 'settings.edit') || can(role, 'audit.view');

  // NAVBAR-REDESIGN Phase 1: daily tasks stay visible; admin views collapse
  // into «المزيد». Same RBAC, same views — only the grouping changes.
  const DAILY_VIEWS = new Set(['pos', 'products', 'suppliers', 'clients', 'returns']);
  const dailyTabs = visibleTabs.filter(t => DAILY_VIEWS.has(t.view));
  const adminTabs = visibleTabs.filter(t => !DAILY_VIEWS.has(t.view));
  const [showMore, setShowMore] = useState(false);
  const moreRef = useDismissOnOutside(showMore, () => setShowMore(false));
  const heldRef = useDismissOnOutside(showHeldDropdown, () => setShowHeldDropdown(false));
  const moreActive = adminTabs.some(t => t.view === activeView) || activeView === 'settings';

  // Role change (or a fresh login) never strands the UI on a hidden view.
  useEffect(() => {
    if (!session) return;
    const ok = visibleTabs.some(t => t.view === activeView) || (activeView === 'settings' && showSettings);
    if (!ok) setActiveView('pos');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.role, activeView]);

  return (
    <header className="topbar bg-[#0b0f17] border-b border-[#1e293b] text-slate-200 select-none sticky top-0 z-40 transition-colors">
      {/* Main Navbar */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        {/* Brand & Logo — official Baraka (بركة) emblem tile */}
        <div
          onClick={() => setActiveView('pos')}
          className="flex items-center gap-2.5 cursor-pointer group shrink-0"
          title={isAr ? 'بركة ماركت — العودة لنقطة البيع' : 'Baraka Market — retour Caisse'}
        >
          {theme === 'light' ? (
            <span className="brand-chip w-10 h-10 rounded-xl bg-[#0b0f17] ring-1 ring-amber-400/40 shadow-md flex items-center justify-center">
              <img
                src="/brand/baraka-mark-256.png"
                alt="Baraka — بركة"
                className="w-8 h-8 object-contain drop-shadow-[0_0_6px_rgba(212,160,23,0.6)]"
                draggable={false}
              />
            </span>
          ) : (
            <img
              src="/brand/baraka-mark-256.png"
              alt="Baraka — بركة"
              className="w-10 h-10 rounded-xl object-contain ring-1 ring-amber-400/25 drop-shadow-[0_0_8px_rgba(212,160,23,0.45)]"
              draggable={false}
            />
          )}
          <span className="font-bold text-lg text-white tracking-tight group-hover:text-emerald-400 transition-colors whitespace-nowrap">
            Baraka Market
          </span>
          {/* BRK-020: trial badge removed — license status lives in Licence/Settings only. */}
        </div>

        {/* Navigation Tabs — daily tasks visible, admin lives under «المزيد» */}
        <nav className="flex-1 min-w-0 flex items-center gap-1" aria-label={isAr ? 'التنقل الرئيسي' : 'Navigation principale'}>
          {dailyTabs.map(t => (
            <button
              key={t.view}
              onClick={() => setActiveView(t.view)}
              title={t.title}
              aria-current={activeView === t.view ? 'page' : undefined}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all cursor-pointer whitespace-nowrap flex-shrink-0 [&_svg]:shrink-0 ${
                activeView === t.view
                  ? t.amber
                    ? 'bg-amber-600 text-white shadow-md shadow-amber-900/40'
                    : 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                  : t.amber
                    ? 'text-amber-400/90 hover:bg-[#162030] hover:text-amber-300'
                    : 'text-slate-300 hover:bg-[#162030] hover:text-white'
              }`}
            >
              {t.icon}
              {/* NAVBAR-REDESIGN Phase 3: single breakpoint — labels collapse to
                  icons under 1100px (tooltip carries the label). Zero overlap. */}
              <span className="hidden min-[1100px]:inline">{t.label}</span>
            </button>
          ))}

          {(adminTabs.length > 0 || showSettings) && (
            <div className="relative flex-shrink-0" ref={moreRef}>
              <button
                onClick={() => setShowMore(prev => !prev)}
                aria-haspopup="menu"
                aria-expanded={showMore}
                title={isAr ? 'مهام إدارية: المحاسبة، التقارير، الإغلاق، الإعدادات' : 'Tâches admin : compta, rapports, clôture, paramètres'}
                aria-label={isAr ? 'المزيد — مهام إدارية' : 'Plus — tâches admin'}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all cursor-pointer whitespace-nowrap ${
                  moreActive
                    ? 'bg-slate-700 text-white shadow-md'
                    : 'text-slate-300 hover:bg-[#162030] hover:text-white'
                }`}
              >
                <MoreHorizontal className="w-4 h-4 flex-shrink-0" />
                <span>{isAr ? 'المزيد' : 'Plus'}</span>
              </button>

              {showMore && (
                <div
                  role="menu"
                  aria-label={isAr ? 'مهام إدارية' : 'Tâches admin'}
                  className="absolute top-full mt-2 start-0 w-60 bg-[#111722] border border-[#1e293b] rounded-xl shadow-2xl p-1.5 z-50"
                >
                  <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                    {isAr ? 'الإدارة والتقارير' : 'Admin & rapports'}
                  </div>
                  {adminTabs.map(t => (
                    <button
                      key={t.view}
                      role="menuitem"
                      onClick={() => { setActiveView(t.view); setShowMore(false); }}
                      title={t.title}
                      aria-current={activeView === t.view ? 'page' : undefined}
                      className={`w-full px-2.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer text-start ${
                        activeView === t.view
                          ? (t.amber ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white')
                          : 'text-slate-300 hover:bg-[#162030] hover:text-white'
                      }`}
                    >
                      {t.icon}
                      <span>{t.label}</span>
                    </button>
                  ))}
                  {showSettings && (
                    <>
                      <div className="my-1 border-t border-[#1e293b]" />
                      <button
                        role="menuitem"
                        onClick={() => { setActiveView('settings'); setShowMore(false); }}
                        title={isAr ? 'إعدادات المحل والضرائب' : 'Paramètres Store & Fiscalité'}
                        className={`w-full px-2.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer text-start ${
                          activeView === 'settings'
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-300 hover:bg-[#162030] hover:text-white'
                        }`}
                      >
                        <Settings className="w-4 h-4 flex-shrink-0" />
                        <span>{isAr ? 'الإعدادات والضرائب' : 'Paramètres & Fiscalité'}</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Hardware & Tools Right Bar */}
        <div className="flex items-center gap-2 shrink-0">
          {/* T8: who is holding the till — lock + logout one tap away.
              NAVBAR-REDESIGN Phase 2: always visible (was hidden below md —
              small screens had NO lock/logout). Name text compacts on xs. */}
          {session && (
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#162030] border border-[#2b3a4f] rounded-lg text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shrink-0" />
              <span className="text-slate-200 font-medium max-w-24 truncate hidden min-[420px]:inline">{session.displayName}</span>
              <span className={`px-1 rounded text-[10px] font-bold ${session.role === 'owner' ? 'bg-amber-500/20 text-amber-300' : session.role === 'manager' ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-500/20 text-slate-300'}`}>
                {session.role}
              </span>
              <button
                onClick={() => lockSession()}
                className="text-slate-400 hover:text-amber-300 transition-colors cursor-pointer"
                title={isAr ? 'قفل الجلسة' : 'Verrouiller'}
                aria-label={isAr ? 'قفل الجلسة' : 'Verrouiller'}
              >
                <Lock className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setShowHeldDropdown(false); void logout(); }}
                className="text-slate-400 hover:text-red-300 transition-colors cursor-pointer"
                title={isAr ? 'تسجيل الخروج' : 'Déconnexion'}
                aria-label={isAr ? 'تسجيل الخروج' : 'Déconnexion'}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
          {/* NAVBAR-REDESIGN Phase 2: live cashier clock — the till's time reference. */}
          <span
            className="px-2.5 py-1.5 bg-[#162030] border border-[#2b3a4f] rounded-lg text-xs text-slate-200 flex items-center gap-1.5 tabular-nums"
            dir="ltr"
            title={isAr ? 'ساعة الصندوق' : 'Heure de caisse'}
          >
            <span className="font-semibold">{clock}</span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-400">{dayStamp}</span>
          </span>
          {/* Day / Night Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 bg-[#162030] hover:bg-[#1e293b] border border-[#2b3a4f] rounded-lg text-slate-300 hover:text-amber-300 transition-colors cursor-pointer"
            title={
              theme === 'dark'
                ? (isAr ? 'تفعيل الوضع النهاري (Light Mode)' : 'Activer Mode Jour')
                : (isAr ? 'تفعيل الوضع الليلي (Dark Mode)' : 'Activer Mode Nuit')
            }
            aria-label={isAr ? 'تبديل النهاري/الليلي' : 'Basculer jour/nuit'}
            aria-pressed={theme === 'light'}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-indigo-500" />
            )}
          </button>

          {/* NAVBAR-REDESIGN Phase 2: ONE held-carts control (was twin Clocks).
              Park lives inside the menu (F4 shortcut unchanged); badge counts held. */}
          <div className="relative" ref={heldRef}>
            <button
              onClick={() => setShowHeldDropdown(prev => !prev)}
              aria-haspopup="menu"
              aria-expanded={showHeldDropdown}
              className="px-2.5 py-1.5 bg-[#162030] hover:bg-[#1e293b] border border-[#2b3a4f] rounded-lg text-xs text-slate-300 flex items-center gap-2 transition-colors cursor-pointer"
              title={isAr ? 'تعليق السلة (F4) / الفواتير المعلقة (F5)' : 'Attente (F4) / Paniers en attente (F5)'}
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden xl:inline">{isAr ? 'المعلق' : 'En Attente'}</span>
              <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-bold flex items-center justify-center border border-amber-500/30">
                {heldCarts.length}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showHeldDropdown && (
              <div role="menu" aria-label={isAr ? 'الفواتير المعلقة' : 'Paniers en attente'} className="absolute top-full mt-2 end-0 w-72 bg-[#111722] border border-[#1e293b] rounded-xl shadow-2xl p-2 z-50">
                <div className="p-2 border-b border-[#1e293b] flex items-center justify-between text-xs text-slate-300">
                  <span className="font-semibold">{isAr ? 'الفواتير المعلقة' : 'Paniers en attente'}</span>
                  <span className="text-[11px] text-slate-400">{heldCarts.length} {isAr ? 'سلة' : 'paniers'}</span>
                </div>

                <button
                  role="menuitem"
                  onClick={() => { holdCurrentCart(); setShowHeldDropdown(false); }}
                  disabled={currentCart.length === 0}
                  className="mt-1.5 w-full px-2.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer text-start bg-[#162030] hover:bg-[#1e293b] text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed border border-[#233145]"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{isAr ? 'تعليق السلة الحالية (F4)' : 'Mettre le panier en attente (F4)'}</span>
                </button>

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

          {/* NAVBAR-REDESIGN Phase 2: scale STATE (read-only) + scale ACTION (toggle).
              Status is never the switch — the eye reads, the button acts. */}
          <span
            className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border tabular-nums ${
              isHardwareScaleActive
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50'
                : 'bg-[#162030] text-slate-400 border-[#2b3a4f]'
            }`}
            dir="ltr"
            title={isAr ? 'حالة الميزان الإلكتروني RS232' : 'État balance RS232'}
          >
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${isHardwareScaleActive ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            {isHardwareScaleActive ? `${(scaleWeightGrams / 1000).toFixed(3)} kg` : (isAr ? 'الميزان' : 'Balance')}
          </span>
          <button
            onClick={() => setHardwareScaleActive(!isHardwareScaleActive)}
            className="p-2 bg-[#162030] hover:bg-[#1e293b] border border-[#2b3a4f] rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
            title={isAr ? 'تفعيل/إيقاف محاكي الميزان الإلكتروني' : 'Activer/couper le simulateur balance'}
            aria-label={isAr ? 'تفعيل/إيقاف محاكي الميزان' : 'Activer/couper le simulateur balance'}
            aria-pressed={isHardwareScaleActive}
          >
            <Scale className="w-4 h-4" />
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
