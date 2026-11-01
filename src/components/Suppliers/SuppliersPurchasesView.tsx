import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Product, PurchaseItem, Supplier, TVARate } from '../../types';
import { formatDZD } from '../../core/display';
import { calculateNewPMP } from '../../utils/accounting';
import {
  Truck,
  Plus,
  Search,
  Building2,
  Phone,
  MapPin,
  FileCheck,
  Receipt,
  PackagePlus,
  DollarSign,
  X,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  TrendingUp,
  CreditCard,
  Banknote,
  FileText,
  Pencil,
  Trash2,
} from 'lucide-react';

export const SuppliersPurchasesView: React.FC = () => {
  const {
    suppliers,
    products,
    purchases,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    recordPurchaseReception,
    settleSupplierDebt,
    language,
  } = useApp();
  const isAr = language === 'ar';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier>(suppliers[0]);
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [showReceptionModal, setShowReceptionModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [settleAmount, setSettleAmount] = useState(0);
  const [settleMethod, setSettleMethod] = useState<'ESPECES' | 'VIREMENT' | 'CHEQUE'>('CHEQUE');
  const [settleRef, setSettleRef] = useState('');

  // Reception lines form state
  const [receptionItems, setReceptionItems] = useState<PurchaseItem[]>([]);
  const [paymentMode, setPaymentMode] = useState<'ESPECES' | 'VIREMENT' | 'CHEQUE' | 'CREDIT'>('CREDIT');
  const [amountPaidInput, setAmountPaidInput] = useState('0');
  const [receptionNote, setReceptionNote] = useState('');

  // Active item row builder inside reception modal
  const [selectedProductId, setSelectedProductId] = useState<number>(products[0]?.id || 1);
  const [incomingQty, setIncomingQty] = useState(20);
  const [incomingBuyPriceHT, setIncomingBuyPriceHT] = useState(100);
  const [incomingTVA, setIncomingTVA] = useState<TVARate>(9);
  const [incomingSellPriceTTC, setIncomingSellPriceTTC] = useState(130);

  // New Supplier form
  const [newSupName, setNewSupName] = useState('');
  const [newSupContact, setNewSupContact] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupAddress, setNewSupAddress] = useState('');
  const [newSupNif, setNewSupNif] = useState('');
  const [newSupRc, setNewSupRc] = useState('');
  const [newSupCategory, setNewSupCategory] = useState('');

  // BRK-020: supplier edit/delete lifecycle.
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [crudMsg, setCrudMsg] = useState('');
  const openEditSupplier = (sup: Supplier) => {
    setEditingSupplier({ ...sup });
    setCrudMsg('');
  };
  const handleDeleteSupplier = (sup: Supplier) => {
    if (sup.balance_due > 0) {
      setCrudMsg(isAr
        ? 'مستحيل: لا يمكن حذف مورد في ذمته دين قائم'
        : 'Impossible de supprimer un fournisseur avec des dettes en cours');
      return;
    }
    if (!window.confirm(isAr ? `حذف المورد ${sup.name}؟` : `Supprimer ${sup.name} ?`)) return;
    deleteSupplier(sup.id);
    if (selectedSupplier?.id === sup.id) setSelectedSupplier(suppliers.find(s => s.id !== sup.id) ?? suppliers[0]);
    setCrudMsg('');
  };

  const filteredSuppliers = suppliers.filter(s => {
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.phone.includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  });

  const totalSupplierDebts = suppliers.reduce((sum, s) => sum + (s.balance_due || 0), 0);

  const supplierPurchases = purchases.filter(p => p.supplier_id === selectedSupplier?.id);

  // Sync selected product defaults in reception modal
  const handleSelectProductChange = (prodId: number) => {
    setSelectedProductId(prodId);
    const prod = products.find(p => p.id === prodId);
    if (prod) {
      setIncomingBuyPriceHT(prod.buy_price);
      setIncomingTVA(prod.tva_rate);
      setIncomingSellPriceTTC(prod.sell_price);
    }
  };

  const handleAddItemToReception = () => {
    const prod = products.find(p => p.id === selectedProductId);
    if (!prod || incomingQty <= 0) return;

    const lineHT = Math.round(incomingQty * incomingBuyPriceHT * 100) / 100;
    const lineTTC = Math.round(lineHT * (1 + incomingTVA / 100) * 100) / 100;

    const newItem: PurchaseItem = {
      product_id: prod.id,
      barcode: prod.barcode,
      name_fr: prod.name_fr,
      name_ar: prod.name_ar,
      quantity: incomingQty,
      unit: prod.unit,
      unit_buy_price_ht: incomingBuyPriceHT,
      tva_rate: incomingTVA,
      unit_sell_price_ttc: incomingSellPriceTTC,
      total_line_ht: lineHT,
      total_line_ttc: lineTTC,
    };

    setReceptionItems(prev => [...prev, newItem]);
  };

  const handleRemoveReceptionItem = (index: number) => {
    setReceptionItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleOpenReception = (sup: Supplier) => {
    setSelectedSupplier(sup);
    setReceptionItems([]);
    setAmountPaidInput('0');
    setPaymentMode('CREDIT');
    if (products.length > 0) {
      handleSelectProductChange(products[0].id);
    }
    setShowReceptionModal(true);
  };

  const handleConfirmReception = (e: React.FormEvent) => {
    e.preventDefault();
    if (receptionItems.length === 0 || !selectedSupplier) return;

    const paid = parseFloat(amountPaidInput) || 0;
    recordPurchaseReception(
      selectedSupplier.id,
      receptionItems,
      paymentMode,
      paid,
      receptionNote
    );

    setShowReceptionModal(false);
  };

  const handleCreateSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupName.trim()) return;

    const created = addSupplier({
      name: newSupName,
      contact_person: newSupContact || 'Responsable Commercial',
      phone: newSupPhone || '-',
      address: newSupAddress || 'Algérie',
      nif: newSupNif,
      rc: newSupRc,
      category: newSupCategory || 'Alimentation Générale',
    });

    setSelectedSupplier(created);
    setShowAddSupplierModal(false);
    setNewSupName('');
    setNewSupContact('');
    setNewSupPhone('');
    setNewSupAddress('');
  };

  const handleExecuteSupplierPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier || settleAmount <= 0) return;

    settleSupplierDebt(
      selectedSupplier.id,
      settleAmount,
      settleMethod,
      settleRef,
      isAr ? 'تسديد مستحقات فاتورة توريد' : 'Paiement facture approvisionnement'
    );

    setShowPaymentModal(false);
  };

  const receptionTotalHT = receptionItems.reduce((sum, item) => sum + item.total_line_ht, 0);
  const receptionTotalTTC = receptionItems.reduce((sum, item) => sum + item.total_line_ttc, 0);

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-80px)] bg-[#0b0f17] overflow-hidden">
      {/* Left Column: Suppliers Directory & Global Debt */}
      <div className="w-full lg:w-96 border-e border-[#1e293b] flex flex-col p-3 bg-[#0e141f]">
        {/* Supplier Total Debt Card */}
        <div className="bg-gradient-to-br from-amber-950/60 to-amber-900/30 border border-amber-800/40 rounded-xl p-3.5 mb-3 shadow-inner">
          <div className="flex items-center justify-between text-xs text-amber-300">
            <span className="flex items-center gap-1.5 font-semibold">
              <Truck className="w-4 h-4 text-amber-400" />
              <span>{isAr ? 'إجمالي ديون الموردين (Dettes Fournisseurs):' : 'Total Dettes Fournisseurs:'}</span>
            </span>
          </div>
          <div className="text-2xl font-black font-mono text-amber-200 mt-1" dir="ltr">
            {formatDZD(totalSupplierDebts, false)}
          </div>
          <div className="text-[11px] text-amber-300/80 mt-0.5">
            {suppliers.length} {isAr ? 'موردين معتمدين' : 'fournisseurs référencés'}
          </div>
        </div>

        {/* Search & Add Supplier Button */}
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute inset-y-0 start-3 my-auto text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'بحث عن مورد...' : 'Rechercher fournisseur...'}
              className="w-full bg-[#111722] border border-[#233145] rounded-xl ps-9 pe-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-500"
            />
          </div>

          <button
            onClick={() => setShowAddSupplierModal(true)}
            className="p-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl shadow cursor-pointer shrink-0"
            title={isAr ? 'إضافة مورد جديد' : 'Nouveau Fournisseur'}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Suppliers List */}
        {crudMsg && (
          <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 mb-2">
            {crudMsg}
          </div>
        )}
        <div className="flex-1 overflow-y-auto space-y-1.5 pe-1">
          {filteredSuppliers.map(sup => {
            const isSelected = selectedSupplier?.id === sup.id;
            return (
              <div
                key={sup.id}
                onClick={() => setSelectedSupplier(sup)}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-amber-950/40 border-amber-500 shadow-md'
                    : 'bg-[#111722] border-[#1e293b] hover:border-slate-600 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white truncate">{sup.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); openEditSupplier(sup); }}
                      title={isAr ? 'تعديل' : 'Modifier'}
                      className="p-1 rounded text-slate-500 hover:text-sky-300 hover:bg-[#162030] cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteSupplier(sup); }}
                      title={isAr ? 'حذف' : 'Supprimer'}
                      className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-[#162030] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <span
                      dir="ltr"
                      className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                        sup.balance_due > 0
                          ? 'bg-amber-900/60 text-amber-300 border border-amber-700/50'
                          : 'bg-emerald-900/40 text-emerald-400'
                      }`}
                    >
                      {formatDZD(sup.balance_due, false)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                  <span>{sup.category}</span>
                  <span dir="ltr">{sup.phone}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Supplier Profile, Inbound Purchases & Direct Stock Feeder */}
      <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
        {selectedSupplier ? (
          <>
            {/* Supplier Profile Card */}
            <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black text-white">{selectedSupplier.name}</h2>
                  <span className="text-xs text-amber-400 font-mono">#{selectedSupplier.id}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
                  <span className="flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>{selectedSupplier.contact_person}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    <span dir="ltr">{selectedSupplier.phone}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span>{selectedSupplier.address}</span>
                  </span>
                  {selectedSupplier.nif && (
                    <span className="text-[11px] font-mono text-slate-300" dir="ltr">
                      NIF: {selectedSupplier.nif}
                    </span>
                  )}
                </div>
              </div>

              {/* Debt & Action Buttons */}
              <div className="flex items-center gap-3">
                <div className="text-end">
                  <span className="text-[11px] text-slate-400 block">{isAr ? 'مستحقات المورد الحالية:' : 'Dette en Cours:'}</span>
                  <span className="text-2xl font-black font-mono text-amber-400" dir="ltr">
                    {formatDZD(selectedSupplier.balance_due, false)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSettleAmount(selectedSupplier.balance_due);
                      setShowPaymentModal(true);
                    }}
                    disabled={selectedSupplier.balance_due <= 0}
                    className="px-3.5 py-2.5 bg-[#162030] hover:bg-[#233145] disabled:opacity-40 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-[#2b3a4f] cursor-pointer"
                  >
                    <DollarSign className="w-4 h-4 text-emerald-400" />
                    <span>{isAr ? 'تسديد مستحقات' : 'Régler'}</span>
                  </button>

                  <button
                    onClick={() => handleOpenReception(selectedSupplier)}
                    className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950/50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <PackagePlus className="w-4 h-4" />
                    <span>{isAr ? 'شراء سلع / إدخال للمخزن' : 'Entrée Marchandises / Stock'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Inbound Goods Reception History */}
            <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 shadow-xl">
              <div className="flex items-center justify-between mb-3 border-b border-[#1e293b] pb-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-400" />
                  <span>{isAr ? 'سجل وصول السلع وفواتير الشراء للمخزن (Bons de Réception)' : 'Historique des Bons de Réception & Factures Achats'}</span>
                </h3>
                <span className="text-xs text-slate-400">
                  {supplierPurchases.length} {isAr ? 'عملية توريد' : 'réceptions'}
                </span>
              </div>

              {supplierPurchases.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  {isAr ? 'لا توجد فواتير استلام سلع مسجلة لهذا المورد بعد' : 'Aucune réception enregistrée pour ce fournisseur'}
                </div>
              ) : (
                <div className="space-y-3">
                  {supplierPurchases.map(purchase => (
                    <div
                      key={purchase.id}
                      className="bg-[#162030] border border-[#233145] rounded-xl p-3 space-y-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2b3a4f] pb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-amber-300 font-mono text-sm">
                            {purchase.invoice_number}
                          </span>
                          <span className="text-slate-400">
                            {new Date(purchase.date).toLocaleString('fr-FR')}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#111722] text-slate-300 border border-[#2b3a4f]">
                            {purchase.payment_method}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 font-mono">
                          <span className="text-slate-400">
                            HT: <strong className="text-slate-200" dir="ltr">{formatDZD(purchase.total_ht, false)}</strong>
                          </span>
                          <span className="text-emerald-400 font-bold" dir="ltr">
                            TTC: {formatDZD(purchase.total_ttc, false)}
                          </span>
                          {purchase.amount_due > 0 && (
                            <span className="text-rose-400 font-bold" dir="ltr">
                              Dû: {formatDZD(purchase.amount_due, false)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Items received into stock */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-start text-[11px]">
                          <thead>
                            <tr className="text-slate-400 font-semibold border-b border-[#233145]">
                              <th className="py-1 text-start">{isAr ? 'السلعة المضافة للمخزن' : 'Article Réceptionné'}</th>
                              <th className="py-1 text-center">{isAr ? 'الكمية المستلمة' : 'Qté Reçue'}</th>
                              <th className="py-1 text-end">{isAr ? 'سعر الشراء (HT)' : 'P.U Achat HT'}</th>
                              <th className="py-1 text-end">{isAr ? 'سعر البيع (TTC)' : 'P.U Vente TTC'}</th>
                              <th className="py-1 text-end">{isAr ? 'الإجمالي TTC' : 'Total TTC'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#233145] font-mono text-slate-300">
                            {purchase.items.map((it, idx) => (
                              <tr key={idx}>
                                <td className="py-1.5 font-sans font-medium text-white">
                                  {it.name_fr}
                                </td>
                                <td className="py-1.5 text-center font-bold text-emerald-400">
                                  +{it.quantity} {it.unit}
                                </td>
                                <td className="py-1.5 text-end text-slate-300">
                                  {formatDZD(it.unit_buy_price_ht, false)}
                                </td>
                                <td className="py-1.5 text-end text-amber-300">
                                  {formatDZD(it.unit_sell_price_ttc, false)}
                                </td>
                                <td className="py-1.5 text-end font-bold text-slate-100">
                                  {formatDZD(it.total_line_ttc, false)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* MODAL: Record Inbound Purchase & Update Stock Directly */}
      {showReceptionModal && selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]">
            <div className="p-4 border-b border-[#1e293b] flex justify-between items-center bg-[#0b0f17]">
              <div className="flex items-center gap-2">
                <PackagePlus className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {isAr ? 'استلام سلع جديدة وإضافتها للمخزن مع احتساب PMP' : 'Bon de Réception Fournisseur (Entrée Stock & PMP)'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {selectedSupplier.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowReceptionModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4">
              {/* Product Inbound Adder Line */}
              <div className="bg-[#162030] border border-[#2b3a4f] rounded-xl p-3.5 space-y-3">
                <span className="text-xs font-bold text-amber-400 block">
                  {isAr ? 'اختر سلعة لإضافتها للمخزن:' : 'Ajouter un article à la réception:'}
                </span>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
                  <div className="md:col-span-2">
                    <label className="text-[10px] text-slate-400 block mb-1">
                      {isAr ? 'المنتج:' : 'Produit:'}
                    </label>
                    <select
                      value={selectedProductId}
                      onChange={e => handleSelectProductChange(parseInt(e.target.value, 10))}
                      className="w-full bg-[#111722] border border-[#2b3a4f] rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name_fr} (Stock: {p.stock_qty})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      {isAr ? 'الكمية المستلمة:' : 'Qté Reçue:'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.1"
                      value={incomingQty}
                      onChange={e => setIncomingQty(parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-xs text-white font-mono font-bold text-emerald-400"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      {isAr ? 'سعر الشراء HT:' : 'P.U Achat HT:'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={incomingBuyPriceHT}
                      onChange={e => setIncomingBuyPriceHT(parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-xs text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      {isAr ? 'سعر البيع TTC:' : 'P.U Vente TTC:'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={incomingSellPriceTTC}
                      onChange={e => setIncomingSellPriceTTC(parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-1.5 text-xs text-white font-mono font-bold text-amber-300"
                    />
                  </div>
                </div>

                {/* Live PMP Calculation Preview */}
                {(() => {
                  const currentProd = products.find(p => p.id === selectedProductId);
                  if (!currentProd) return null;
                  const futurePMP = calculateNewPMP(
                    currentProd.stock_qty,
                    currentProd.buy_price,
                    incomingQty,
                    incomingBuyPriceHT
                  );
                  return (
                    <div className="bg-[#111722] p-2 rounded-lg text-[11px] text-slate-300 flex flex-wrap items-center justify-between border border-[#1e293b]">
                      <div>
                        {isAr ? 'المخزون الحالي:' : 'Stock Actuel:'}{' '}
                        <strong>{currentProd.stock_qty}</strong> • PMP {isAr ? 'الحالي:' : 'Actuel:'}{' '}
                        <strong dir="ltr">{formatDZD(currentProd.buy_price, false)}</strong>
                      </div>
                      <div className="text-emerald-400 flex items-center gap-1 font-semibold">
                        <span>{isAr ? 'المخزون بعد الإدخال:' : 'Nouveau Stock:'} {currentProd.stock_qty + incomingQty}</span>
                        <span>•</span>
                        <span>Nouveau PMP: <strong dir="ltr">{formatDZD(futurePMP, false)}</strong></span>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddItemToReception}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isAr ? 'إدراج السلعة في وصل الاستلام' : 'Insérer dans le Bon'}</span>
                  </button>
                </div>
              </div>

              {/* Items in Current Voucher */}
              <div className="border border-[#1e293b] rounded-xl overflow-hidden">
                <table className="w-full text-start text-xs border-collapse">
                  <thead className="bg-[#0b0f17] text-slate-400 text-[10px] font-semibold border-b border-[#1e293b]">
                    <tr>
                      <th className="py-2 px-3 text-start">{isAr ? 'السلعة' : 'Désignation'}</th>
                      <th className="py-2 px-3 text-center">{isAr ? 'الكمية' : 'Quantité'}</th>
                      <th className="py-2 px-3 text-end">{isAr ? 'سعر الشراء HT' : 'P.U Achat HT'}</th>
                      <th className="py-2 px-3 text-end">{isAr ? 'سعر البيع TTC' : 'P.U Vente TTC'}</th>
                      <th className="py-2 px-3 text-end">{isAr ? 'المجموع TTC' : 'Total TTC'}</th>
                      <th className="py-2 px-3 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#162030] text-slate-300 font-mono">
                    {receptionItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500 font-sans">
                          {isAr ? 'لم تتم إضافة أي سلعة بعد' : 'Aucun article ajouté au bon'}
                        </td>
                      </tr>
                    ) : (
                      receptionItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="py-2 px-3 font-sans font-medium text-white">{item.name_fr}</td>
                          <td className="py-2 px-3 text-center text-emerald-400 font-bold">
                            +{item.quantity} {item.unit}
                          </td>
                          <td className="py-2 px-3 text-end">{formatDZD(item.unit_buy_price_ht, false)}</td>
                          <td className="py-2 px-3 text-end text-amber-300">{formatDZD(item.unit_sell_price_ttc, false)}</td>
                          <td className="py-2 px-3 text-end font-bold text-white">{formatDZD(item.total_line_ttc, false)}</td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveReceptionItem(idx)}
                              className="text-slate-500 hover:text-rose-400"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Payment Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#0b0f17] p-3.5 rounded-xl border border-[#1e293b]">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 block">
                    {isAr ? 'طريقة تسوية فاتورة المورد:' : 'Règlement Fournisseur:'}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMode('CREDIT');
                        setAmountPaidInput('0');
                      }}
                      className={`p-2 rounded-lg border text-xs font-bold text-center ${
                        paymentMode === 'CREDIT'
                          ? 'bg-amber-950/80 border-amber-500 text-amber-200'
                          : 'bg-[#162030] border-[#2b3a4f] text-slate-400'
                      }`}
                    >
                      {isAr ? 'بالدَّيْن (Crédit)' : 'À Crédit (Dette)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMode('ESPECES');
                        setAmountPaidInput(receptionTotalTTC.toString());
                      }}
                      className={`p-2 rounded-lg border text-xs font-bold text-center ${
                        paymentMode === 'ESPECES'
                          ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                          : 'bg-[#162030] border-[#2b3a4f] text-slate-400'
                      }`}
                    >
                      {isAr ? 'نقداً (Comptant)' : 'Comptant'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 font-mono text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Total HT:</span>
                    <span dir="ltr">{formatDZD(receptionTotalHT)}</span>
                  </div>
                  <div className="flex justify-between text-base font-black text-emerald-400 border-t border-[#1e293b] pt-1">
                    <span>Total TTC:</span>
                    <span dir="ltr">{formatDZD(receptionTotalTTC, false)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-[#0b0f17] border-t border-[#1e293b] flex justify-between items-center">
              <span className="text-[11px] text-emerald-400">
                {isAr
                  ? 'عند التأكيد: تُضاف الكميات مباشرة للمخزن ويُعاد حساب PMP تلقائياً'
                  : 'Mise à jour immédiate du stock et recalcul automatique du PMP'}
              </span>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowReceptionModal(false)}
                  className="px-4 py-2 bg-[#162030] text-slate-300 rounded-xl text-xs"
                >
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReception}
                  disabled={receptionItems.length === 0}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950/40 cursor-pointer"
                >
                  {isAr ? 'تأكيد الاستلام وتحديث المخزن' : 'Valider & Entrer en Stock'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BRK-020 MODAL: Edit Supplier */}
      {editingSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#1e293b] flex justify-between items-center bg-[#0b0f17]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-sky-400" />
                <span>{isAr ? 'تعديل المورد' : 'Modifier Fournisseur'}</span>
              </h3>
              <button onClick={() => setEditingSupplier(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={e => {
                e.preventDefault();
                if (!editingSupplier.name.trim()) return;
                updateSupplier(editingSupplier.id, {
                  name: editingSupplier.name,
                  contact_person: editingSupplier.contact_person,
                  phone: editingSupplier.phone,
                  address: editingSupplier.address,
                  nif: editingSupplier.nif,
                  rc: editingSupplier.rc,
                  category: editingSupplier.category,
                });
                setSelectedSupplier({ ...editingSupplier });
                setEditingSupplier(null);
              }}
              className="p-4 space-y-3"
            >
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'اسم الشركة الموردة:' : 'Raison Sociale:'} *
                </label>
                <input
                  type="text" required
                  value={editingSupplier.name}
                  onChange={e => setEditingSupplier({ ...editingSupplier, name: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">{isAr ? 'الهاتف:' : 'Téléphone:'}</label>
                  <input
                    type="tel"
                    value={editingSupplier.phone}
                    onChange={e => setEditingSupplier({ ...editingSupplier, phone: e.target.value })}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">NIF:</label>
                  <input
                    type="text"
                    value={editingSupplier.nif ?? ''}
                    onChange={e => setEditingSupplier({ ...editingSupplier, nif: e.target.value })}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">{isAr ? 'العنوان:' : 'Adresse:'}</label>
                <input
                  type="text"
                  value={editingSupplier.address}
                  onChange={e => setEditingSupplier({ ...editingSupplier, address: e.target.value })}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditingSupplier(null)} className="px-4 py-2 bg-[#162030] text-slate-300 rounded-lg text-xs">
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
                <button type="submit" className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold">
                  {isAr ? 'حفظ' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add New Supplier */}
      {showAddSupplierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#1e293b] flex justify-between items-center bg-[#0b0f17]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Truck className="w-4 h-4 text-amber-400" />
                <span>{isAr ? 'إضافة مورد جديد' : 'Nouveau Fournisseur'}</span>
              </h3>
              <button
                onClick={() => setShowAddSupplierModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSupplier} className="p-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'اسم الشركة الموردة:' : 'Raison Sociale Fournisseur:'} *
                </label>
                <input
                  type="text"
                  required
                  value={newSupName}
                  onChange={e => setNewSupName(e.target.value)}
                  placeholder="Ex: SARL AGRO DISTRIB"
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'الشخص المسؤول:' : 'Contact:'}
                  </label>
                  <input
                    type="text"
                    value={newSupContact}
                    onChange={e => setNewSupContact(e.target.value)}
                    placeholder="M. Mohamed"
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'الهاتف:' : 'Téléphone:'}
                  </label>
                  <input
                    type="tel"
                    value={newSupPhone}
                    onChange={e => setNewSupPhone(e.target.value)}
                    placeholder="034 XX XX XX"
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'النشاط / الفئة:' : 'Catégorie de Produits:'}
                </label>
                <input
                  type="text"
                  value={newSupCategory}
                  onChange={e => setNewSupCategory(e.target.value)}
                  placeholder="Ex: Huiles, Produits Laitiers..."
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    NIF (15 chiffres):
                  </label>
                  <input
                    type="text"
                    value={newSupNif}
                    onChange={e => setNewSupNif(e.target.value)}
                    placeholder="00021600..."
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    RC:
                  </label>
                  <input
                    type="text"
                    value={newSupRc}
                    onChange={e => setNewSupRc(e.target.value)}
                    placeholder="16/00-..."
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddSupplierModal(false)}
                  className="px-4 py-2 bg-[#162030] text-slate-300 rounded-lg text-xs"
                >
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold"
                >
                  {isAr ? 'حفظ المورد' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Settle Supplier Debt */}
      {showPaymentModal && selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#1e293b] flex justify-between items-center bg-[#0b0f17]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>{isAr ? 'تسديد مستحقات للمورد' : 'Règlement Fournisseur'}</span>
              </h3>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteSupplierPayment} className="p-4 space-y-3">
              <div>
                <span className="text-xs text-slate-400">{isAr ? 'المورد:' : 'Fournisseur:'}</span>
                <div className="text-sm font-bold text-white mt-0.5">{selectedSupplier.name}</div>
                <div className="text-xs text-amber-400 mt-0.5">
                  {isAr ? 'إجمالي الدين المستحق للمورد:' : 'Solde dû:'}{' '}
                  <strong dir="ltr">{formatDZD(selectedSupplier.balance_due, false)}</strong>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'المبلغ المسدد (دينار جزائري):' : 'Montant à Régler (DZD):'}
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max={selectedSupplier.balance_due}
                  value={settleAmount}
                  onChange={e => setSettleAmount(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-xl px-3 py-2 text-white font-mono text-lg font-bold outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'طريقة الدفع:' : 'Mode de Paiement:'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSettleMethod('CHEQUE')}
                    className={`py-2 rounded-lg border text-xs font-bold text-center ${
                      settleMethod === 'CHEQUE'
                        ? 'bg-emerald-950/80 border-emerald-500 text-white'
                        : 'bg-[#162030] border-[#2b3a4f] text-slate-400'
                    }`}
                  >
                    Chèque
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettleMethod('VIREMENT')}
                    className={`py-2 rounded-lg border text-xs font-bold text-center ${
                      settleMethod === 'VIREMENT'
                        ? 'bg-emerald-950/80 border-emerald-500 text-white'
                        : 'bg-[#162030] border-[#2b3a4f] text-slate-400'
                    }`}
                  >
                    Virement
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettleMethod('ESPECES')}
                    className={`py-2 rounded-lg border text-xs font-bold text-center ${
                      settleMethod === 'ESPECES'
                        ? 'bg-emerald-950/80 border-emerald-500 text-white'
                        : 'bg-[#162030] border-[#2b3a4f] text-slate-400'
                    }`}
                  >
                    Espèces
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'رقم الشيك أو الحوالة:' : 'N° Chèque / Référence:'}
                </label>
                <input
                  type="text"
                  value={settleRef}
                  onChange={e => setSettleRef(e.target.value)}
                  placeholder="CHQ-982341..."
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="px-4 py-2 bg-[#162030] text-slate-300 rounded-lg text-xs"
                >
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold"
                >
                  {isAr ? 'تأكيد التسديد' : 'Confirmer Règlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
