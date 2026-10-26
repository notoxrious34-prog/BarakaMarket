import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Product, TVARate } from '../../types';
import { formatDZD } from '../../core/display';
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  Scale,
  Calendar,
  Tag,
  Edit2,
  Trash2,
  X,
  Sparkles,
  TrendingUp,
  Percent,
} from 'lucide-react';
import { initialCategories } from '../../data/seedData';

export const ProductsStockView: React.FC = () => {
  const { products, addProduct, updateProduct, deleteProduct, language } = useApp();
  const isAr = language === 'ar';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [filterMode, setFilterMode] = useState<'all' | 'low_stock' | 'perishable'>('all');

  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form fields
  const [barcode, setBarcode] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [categoryId, setCategoryId] = useState('epicerie');
  const [buyPrice, setBuyPrice] = useState(100);
  const [sellPrice, setSellPrice] = useState(130);
  const [tvaRate, setTvaRate] = useState<TVARate>(9);
  const [stockQty, setStockQty] = useState(50);
  const [minAlert, setMinAlert] = useState(10);
  const [unit, setUnit] = useState<'PIECE' | 'KG' | 'LITRE'>('PIECE');
  const [isScaleProduct, setIsScaleProduct] = useState(false);
  const [scaleItemCode, setScaleItemCode] = useState('00040');
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');

  // Perishable items check (< 30 days)
  const today = new Date();
  const thirtyDaysOut = new Date(today.getTime() + 30 * 24 * 3600 * 1000);

  const isExpiringSoon = (p: Product) => {
    if (!p.has_expiry_date || !p.expiry_date) return false;
    const exp = new Date(p.expiry_date);
    return exp <= thirtyDaysOut;
  };

  const isStockLow = (p: Product) => p.stock_qty <= p.min_stock_alert;

  const lowStockCount = products.filter(isStockLow).length;
  const expiringCount = products.filter(isExpiringSoon).length;

  const filteredProducts = products.filter(p => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      p.name_fr.toLowerCase().includes(q) ||
      p.name_ar.includes(q) ||
      p.barcode.includes(q);

    const matchesCat = selectedCategory === 'all' || p.category_id === selectedCategory;

    if (!matchesSearch || !matchesCat) return false;

    if (filterMode === 'low_stock') return isStockLow(p);
    if (filterMode === 'perishable') return isExpiringSoon(p);

    return true;
  });

  const handleOpenAddModal = () => {
    setEditingProduct(null);
    setBarcode(`613${Math.floor(1000000000 + Math.random() * 9000000000)}`);
    setNameFr('');
    setNameAr('');
    setCategoryId('epicerie');
    setBuyPrice(100);
    setSellPrice(130);
    setTvaRate(9);
    setStockQty(50);
    setMinAlert(10);
    setUnit('PIECE');
    setIsScaleProduct(false);
    setScaleItemCode('00045');
    setHasExpiry(false);
    setExpiryDate('');
    setShowProductModal(true);
  };

  const handleOpenEditModal = (p: Product) => {
    setEditingProduct(p);
    setBarcode(p.barcode);
    setNameFr(p.name_fr);
    setNameAr(p.name_ar);
    setCategoryId(p.category_id);
    setBuyPrice(p.buy_price);
    setSellPrice(p.sell_price);
    setTvaRate(p.tva_rate);
    setStockQty(p.stock_qty);
    setMinAlert(p.min_stock_alert);
    setUnit(p.unit);
    setIsScaleProduct(!!p.is_scale_product);
    setScaleItemCode(p.scale_item_code || '00040');
    setHasExpiry(p.has_expiry_date);
    setExpiryDate(p.expiry_date || '');
    setShowProductModal(true);
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameFr.trim() || !barcode.trim()) return;

    if (editingProduct) {
      updateProduct(editingProduct.id, {
        barcode,
        name_fr: nameFr,
        name_ar: nameAr || nameFr,
        category_id: categoryId,
        buy_price: buyPrice,
        sell_price: sellPrice,
        tva_rate: tvaRate,
        stock_qty: stockQty,
        min_stock_alert: minAlert,
        unit,
        is_scale_product: isScaleProduct,
        scale_item_code: isScaleProduct ? scaleItemCode : undefined,
        has_expiry_date: hasExpiry,
        expiry_date: hasExpiry ? expiryDate : undefined,
      });
    } else {
      addProduct({
        barcode,
        name_fr: nameFr,
        name_ar: nameAr || nameFr,
        category_id: categoryId,
        buy_price: buyPrice,
        sell_price: sellPrice,
        tva_rate: tvaRate,
        stock_qty: stockQty,
        min_stock_alert: minAlert,
        unit,
        is_scale_product: isScaleProduct,
        scale_item_code: isScaleProduct ? scaleItemCode : undefined,
        has_expiry_date: hasExpiry,
        expiry_date: hasExpiry ? expiryDate : undefined,
      });
    }

    setShowProductModal(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-[#0b0f17] p-4 overflow-hidden">
      {/* Top Bar: Stats & Filters */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* All */}
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              filterMode === 'all'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-[#111722] text-slate-400 border border-[#1e293b]'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>{isAr ? 'كل المواد' : 'Tous les Articles'} ({products.length})</span>
          </button>

          {/* Low Stock Alert */}
          <button
            onClick={() => setFilterMode('low_stock')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              filterMode === 'low_stock'
                ? 'bg-amber-600 text-white shadow-md'
                : 'bg-[#111722] text-slate-400 border border-[#1e293b]'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>{isAr ? 'نقص المخزون' : 'Alerte Rupture'} ({lowStockCount})</span>
          </button>

          {/* Perishable Tracking (Péremption) */}
          <button
            onClick={() => setFilterMode('perishable')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              filterMode === 'perishable'
                ? 'bg-rose-600 text-white shadow-md'
                : 'bg-[#111722] text-slate-400 border border-[#1e293b]'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-rose-400" />
            <span>{isAr ? 'قريب انتهاء الصلاحية' : 'Dates Courtes'} ({expiringCount})</span>
          </button>
        </div>

        {/* Search & Add Action */}
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute inset-y-0 start-3 my-auto text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'بحث بالاسم أو الباركود...' : 'Recherche par nom ou code...'}
              className="w-full bg-[#111722] border border-[#233145] rounded-xl ps-9 pe-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
            />
          </div>

          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{isAr ? 'إضافة منتج جديد' : 'Nouveau Produit'}</span>
          </button>
        </div>
      </div>

      {/* Products Table */}
      <div className="flex-1 bg-[#111722] border border-[#1e293b] rounded-2xl overflow-hidden flex flex-col shadow-xl">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-start text-xs border-collapse">
            <thead className="bg-[#0b0f17] text-slate-400 uppercase text-[10px] font-semibold sticky top-0 border-b border-[#1e293b] z-10">
              <tr>
                <th className="py-3 px-4 text-start">{isAr ? 'الباركود' : 'Code-Barres'}</th>
                <th className="py-3 px-4 text-start">{isAr ? 'الاسم (فرنسي / عربي)' : 'Désignation'}</th>
                <th className="py-3 px-4 text-center">{isAr ? 'القسم' : 'Rayon'}</th>
                <th className="py-3 px-4 text-end">{isAr ? 'سعر الشراء (HT)' : 'Prix Achat'}</th>
                <th className="py-3 px-4 text-end">{isAr ? 'سعر البيع (TTC)' : 'Prix Vente'}</th>
                <th className="py-3 px-4 text-center">{isAr ? 'TVA' : 'Taux TVA'}</th>
                <th className="py-3 px-4 text-center">{isAr ? 'المخزون' : 'Stock'}</th>
                <th className="py-3 px-4 text-center">{isAr ? 'الصلاحية' : 'Péremption'}</th>
                <th className="py-3 px-4 text-end">{isAr ? 'إجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#162030] text-slate-300">
              {filteredProducts.map(p => {
                const nearExp = isExpiringSoon(p);
                const lowStock = isStockLow(p);

                return (
                  <tr key={p.id} className="hover:bg-[#162030]/60 transition-colors">
                    {/* Barcode */}
                    <td className="py-2.5 px-4 font-mono text-[11px] text-amber-300">
                      {p.barcode}
                    </td>

                    {/* Name */}
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <span>{p.name_fr}</span>
                        {p.is_scale_product && (
                          <span className="text-[9px] bg-emerald-950 text-emerald-400 px-1 py-0.2 rounded border border-emerald-800">
                            Balance #{p.scale_item_code}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-arabic">{p.name_ar}</div>
                    </td>

                    {/* Category */}
                    <td className="py-2.5 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#162030] text-slate-400 border border-[#2b3a4f]">
                        {p.category_id}
                      </span>
                    </td>

                    {/* Buy Price */}
                    <td className="py-2.5 px-4 text-end font-mono text-slate-400">
                      {formatDZD(p.buy_price, false)}
                    </td>

                    {/* Sell Price */}
                    <td className="py-2.5 px-4 text-end font-mono font-bold text-emerald-400">
                      {formatDZD(p.sell_price, false)}
                    </td>

                    {/* TVA */}
                    <td className="py-2.5 px-4 text-center">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          p.tva_rate === 0
                            ? 'bg-sky-950 text-sky-400'
                            : p.tva_rate === 9
                            ? 'bg-amber-950 text-amber-400'
                            : 'bg-purple-950 text-purple-400'
                        }`}
                      >
                        {p.tva_rate}%
                      </span>
                    </td>

                    {/* Stock */}
                    <td className="py-2.5 px-4 text-center font-mono">
                      <span
                        className={`font-bold ${
                          lowStock ? 'text-rose-400 font-black' : 'text-slate-200'
                        }`}
                      >
                        {p.stock_qty} {p.unit === 'KG' ? 'kg' : 'u'}
                      </span>
                      {lowStock && (
                        <div className="text-[9px] text-rose-400 font-sans">
                          {isAr ? 'منخفض' : 'Alerte'}
                        </div>
                      )}
                    </td>

                    {/* Expiration date */}
                    <td className="py-2.5 px-4 text-center text-[11px]">
                      {p.has_expiry_date && p.expiry_date ? (
                        <span
                          className={`px-1.5 py-0.5 rounded font-mono ${
                            nearExp
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : 'text-slate-400'
                          }`}
                        >
                          {p.expiry_date}
                        </span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-4 text-end">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleOpenEditModal(p)}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-[#233145] rounded-lg cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteProduct(p.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-[#111722] border border-[#1e293b] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-auto">
            <div className="p-4 border-b border-[#1e293b] flex justify-between items-center bg-[#0b0f17]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-400" />
                <span>
                  {editingProduct
                    ? (isAr ? 'تعديل بيانات المنتج' : 'Modifier le Produit')
                    : (isAr ? 'إضافة منتج جديد للمخزن' : 'Nouveau Produit')}
                </span>
              </h3>
              <button
                onClick={() => setShowProductModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'الباركود (EAN-13):' : 'Code-Barres:'}
                  </label>
                  <input
                    type="text"
                    required
                    value={barcode}
                    onChange={e => setBarcode(e.target.value)}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'القسم:' : 'Rayon:'}
                  </label>
                  <select
                    value={categoryId}
                    onChange={e => setCategoryId(e.target.value)}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    {initialCategories.filter(c => c.id !== 'all').map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name_fr} ({c.name_ar})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'الاسم بالفرنسية:' : 'Nom (Français):'}
                </label>
                <input
                  type="text"
                  required
                  value={nameFr}
                  onChange={e => setNameFr(e.target.value)}
                  placeholder="Ex: HUILE ELIO 5L"
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {isAr ? 'الاسم بالعربية:' : 'Nom (Arabe):'}
                </label>
                <input
                  type="text"
                  value={nameAr}
                  onChange={e => setNameAr(e.target.value)}
                  placeholder="مثال: زيت إيليو 5 لتر"
                  className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white font-arabic"
                  dir="rtl"
                />
              </div>

              {/* Prices & Taxes */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'سعر الشراء (PMP):' : 'Prix Achat:'}
                  </label>
                  <input
                    type="number"
                    required
                    value={buyPrice}
                    onChange={e => setBuyPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'سعر البيع (TTC):' : 'Prix Vente (TTC):'}
                  </label>
                  <input
                    type="number"
                    required
                    value={sellPrice}
                    onChange={e => setSellPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white font-mono font-bold text-emerald-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'نسبة TVA:' : 'Taux TVA:'}
                  </label>
                  <select
                    value={tvaRate}
                    onChange={e => setTvaRate(parseInt(e.target.value, 10) as TVARate)}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    <option value={0}>0% (Exempt)</option>
                    <option value={9}>9% (Réduit)</option>
                    <option value={19}>19% (Normal)</option>
                  </select>
                </div>
              </div>

              {/* Stock & Unit */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'الكمية في المخزن:' : 'Quantité Stock:'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={stockQty}
                    onChange={e => setStockQty(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'تنبيه النقص:' : 'Alerte Min:'}
                  </label>
                  <input
                    type="number"
                    value={minAlert}
                    onChange={e => setMinAlert(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isAr ? 'الوحدة:' : 'Unité:'}
                  </label>
                  <select
                    value={unit}
                    onChange={e => setUnit(e.target.value as any)}
                    className="w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    <option value="PIECE">Pièce (قطعة)</option>
                    <option value="KG">Kilogramme (كغ)</option>
                    <option value="LITRE">Litre (لتر)</option>
                  </select>
                </div>
              </div>

              {/* Scale Produce Checkbox */}
              <div className="p-2.5 bg-[#162030] rounded-xl border border-[#2b3a4f] space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="scale-chk"
                    checked={isScaleProduct}
                    onChange={e => setIsScaleProduct(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500 bg-[#0b0f17] border-[#2b3a4f]"
                  />
                  <label htmlFor="scale-chk" className="text-xs font-semibold text-slate-200 cursor-pointer">
                    {isAr ? 'مادة توزن بالميزان الإلكتروني (Code Balance 20XXXXX)' : 'Article au poids avec balance'}
                  </label>
                </div>

                {isScaleProduct && (
                  <div className="ps-6">
                    <label className="text-[11px] text-slate-400 block mb-0.5">
                      {isAr ? 'رمز الميزان (5 أرقام):' : 'Code PLU Balance (5 chiffres):'}
                    </label>
                    <input
                      type="text"
                      maxLength={5}
                      value={scaleItemCode}
                      onChange={e => setScaleItemCode(e.target.value)}
                      placeholder="00040"
                      className="w-32 bg-[#0b0f17] border border-[#2b3a4f] rounded px-2 py-1 text-xs text-amber-300 font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Expiry Checkbox */}
              <div className="p-2.5 bg-[#162030] rounded-xl border border-[#2b3a4f] space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="expiry-chk"
                    checked={hasExpiry}
                    onChange={e => setHasExpiry(e.target.checked)}
                    className="w-4 h-4 rounded text-rose-500 bg-[#0b0f17] border-[#2b3a4f]"
                  />
                  <label htmlFor="expiry-chk" className="text-xs font-semibold text-slate-200 cursor-pointer">
                    {isAr ? 'مادة خاضعة لتاريخ انتهاء الصلاحية' : 'Suivi de Date de Péremption'}
                  </label>
                </div>

                {hasExpiry && (
                  <div className="ps-6">
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={e => setExpiryDate(e.target.value)}
                      className="bg-[#0b0f17] border border-[#2b3a4f] rounded px-3 py-1 text-xs text-white font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Footer Buttons */}
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 bg-[#162030] text-slate-300 rounded-lg text-xs"
                >
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold"
                >
                  {isAr ? 'حفظ المنتج' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
