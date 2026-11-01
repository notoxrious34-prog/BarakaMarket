import React, { useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Product, TVARate } from '../../types';
import { preflightCsv, ParsedProductRow } from '../../core/csv-importer.js';
import { generateA4LabelsHtml, ShelfLabelItem } from '../../core/shelf-labels.js';
import { generateEan13Svg } from '../../core/barcode-svg.js';
import { REF_TO_PRODUCT_CATEGORY } from '../../core/reference-search.js';
import { initialCategories } from '../../data/seedData';

const card = 'bg-[#101724] border border-[#1e293b] rounded-2xl p-4 w-full max-w-2xl max-h-[85vh] overflow-y-auto';
const input = 'w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors disabled:opacity-40';
const overlay = 'fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4';

const RAYONS = new Set(initialCategories.map(c => c.id));
const mapCategory = (raw: string): string => {
  const t = (raw ?? '').trim();
  if (REF_TO_PRODUCT_CATEGORY[t]) return REF_TO_PRODUCT_CATEGORY[t];
  if (RAYONS.has(t)) return t;
  return 'epicerie';
};

const toProduct = (r: ParsedProductRow, isAr: boolean): Omit<Product, 'id'> => ({
  barcode: r.barcode,
  name_fr: r.name_fr || (isAr ? 'منتج مستورد' : 'Produit importé'),
  name_ar: r.name_ar || '',
  category_id: mapCategory(r.category),
  buy_price: r.buyPriceCt / 100,
  sell_price: r.priceCt / 100,
  tva_rate: r.tvaRate as TVARate,
  stock_qty: r.stockMilli / 1000,
  min_stock_alert: 5,
  unit: r.unit,
  has_expiry_date: false,
});

/** ADR-018: bulk CSV importer — 100% in-client (preflightCsv + AppContext UPSERT). */
export const CsvImportModal: React.FC<{ isAr: boolean; onClose: () => void }> = ({ isAr, onClose }) => {
  const { products, addProduct, updateProduct } = useApp();
  const [csv, setCsv] = useState('barcode;name_fr;sell_price_ct;tva_rate\n6130000000015;HUILE ELIO 5L;65000;0');
  const [rows, setRows] = useState<ParsedProductRow[] | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [msg, setMsg] = useState('');

  const doPreview = () => {
    setMsg('');
    try {
      const rep = preflightCsv(csv);
      setRows(rep.validRows);
      setErrs(rep.errors.map(e => `L${e.row} [${e.field}] ${e.message}`));
    } catch (e) {
      setRows(null);
      setErrs([(e as Error).message]);
    }
  };
  const doExecute = () => {
    if (!rows) return;
    let inserted = 0, updated = 0;
    for (const r of rows) {
      const existing = products.find(p => p.barcode === r.barcode);
      if (existing) {
        updateProduct(existing.id, toProduct(r, isAr));
        updated += 1;
      } else {
        addProduct(toProduct(r, isAr));
        inserted += 1;
      }
    }
    const n = inserted + updated;
    setMsg(isAr
      ? `${n} منتج مستورد بنجاح (${inserted} جديد، ${updated} محدّث)`
      : `${n} produits importés avec succès (${inserted} nouveaux, ${updated} màj)`);
    setRows(null);
  };

  return (
    <div className={overlay} onClick={onClose}>
      <div className={card} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-3">{isAr ? 'استيراد CSV بالجملة' : 'Importer CSV (vrac)'}</h3>
        <textarea className={`${input} font-mono h-28`} value={csv} onChange={e => setCsv(e.target.value)} dir="ltr" />
        <div className="flex gap-2 mt-3">
          <button className={`${btn} bg-[#1e293b] hover:bg-[#2b3a4f] text-white`} onClick={doPreview}>{isAr ? 'معاينة' : 'Prévisualiser'}</button>
          <button disabled={!rows} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`} onClick={doExecute}>{isAr ? 'تنفيذ UPSERT' : 'Exécuter (UPSERT)'}</button>
          <button className={`${btn} bg-transparent text-slate-400 hover:text-white`} onClick={onClose}>{isAr ? 'إغلاق' : 'Fermer'}</button>
        </div>
        {msg && <div className="text-[11px] text-emerald-300 mt-2">{msg}</div>}
        {(rows || errs.length > 0) && (
          <div className="mt-3 text-[11px]">
            {rows && <div className="text-slate-300 mb-1">{isAr ? 'صفوف صالحة: ' : 'Lignes valides: '}{rows.length}</div>}
            {errs.slice(0, 8).map((e, i) => <div key={i} className="text-rose-300 font-mono">{e}</div>)}
            {(rows ?? []).slice(0, 10).map((r, i) => (
              <div key={i} className="text-slate-400 font-mono truncate">{r.barcode} · {r.name_fr} · {(r.priceCt / 100).toFixed(2)} DA · TVA {r.tvaRate}%</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** ADR-018: shelf-edge labels — in-client SVG + browser print (no loopback). */
export const ShelfLabelsDialog: React.FC<{ isAr: boolean; products: Product[]; onClose: () => void }> = ({ isAr, products, onClose }) => {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [html, setHtml] = useState('');
  const [msg, setMsg] = useState('');
  const filtered = products.filter(p => `${p.name_fr} ${p.name_ar} ${p.barcode}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);

  const toggle = (id: number) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const toLabelItem = (p: Product): ShelfLabelItem => ({
    id: p.id, barcode: p.barcode, nameFr: p.name_fr, nameAr: p.name_ar || undefined,
    sellPriceCt: Math.round(p.sell_price * 100), unit: p.unit,
    isScale: !!p.is_scale_product, scaleCode: p.scale_item_code,
    tvaRate: p.tva_rate, category: p.category_id,
  });
  const items = () => {
    const out: ShelfLabelItem[] = [];
    let skipped = 0;
    for (const p of products.filter(p => sel.includes(p.id))) {
      try {
        generateEan13Svg(p.barcode);
        out.push(toLabelItem(p));
      } catch { skipped += 1; }
    }
    return { out, skipped };
  };

  const doPreview = () => {
    const { out, skipped } = items();
    if (!out.length) { setMsg(isAr ? 'اختر منتجاً بباركود EAN صالح' : 'Sélectionnez un produit à code-barres EAN valide'); return; }
    setHtml(generateA4LabelsHtml(out));
    setMsg(skipped > 0 ? (isAr ? `تم تخطي ${skipped} (باركود غير صالح)` : `${skipped} ignoré(s) — code-barres invalide`) : '');
  };

  const doPrint80 = () => {
    const { out } = items();
    if (!out.length) { setMsg(isAr ? 'اختر منتجاً بباركود EAN صالح' : 'Sélectionnez un produit à code-barres EAN valide'); return; }
    const strips = out.map(it => {
      const svg = generateEan13Svg(it.barcode, { moduleWidth: 2, height: 48 });
      const price = Number.isInteger(it.sellPriceCt / 100) ? String(it.sellPriceCt / 100) : (it.sellPriceCt / 100).toFixed(2);
      return `<div class="strip"><div class="store">BARAKA MARKET</div><div class="name">${it.nameFr}</div><div class="price">*** ${price} DA ***</div><div class="bc">${svg}</div><div class="code">${it.barcode}</div><div class="cut">✂ - - - - - - - - - -</div></div>`;
    }).join('\n');
    const w = window.open('', '_blank', 'width=320,height=600');
    if (!w) { setMsg(isAr ? 'اسمح بالنوافذ المنبثقة للطبع' : 'Autorisez les popups pour imprimer'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>80mm</title><style>@page{size:80mm auto;margin:2mm}body{font-family:Arial;margin:0}.strip{width:72mm;text-align:center;page-break-after:always;padding:2mm 0}.store{font-size:10pt;font-weight:bold}.name{font-size:11pt;font-weight:bold}.price{font-size:20pt;font-weight:900;margin:2mm 0}.bc svg{width:100%;height:14mm}.code{font-size:8pt;letter-spacing:2px;font-family:monospace}.cut{margin-top:3mm;color:#888}</style></head><body>${strips}<script>onload=()=>{print();}<\/script></body></html>`);
    w.document.close();
    setMsg(isAr ? 'تم فتح نافذة الطبع 80مم' : 'Fenêtre d’impression 80mm ouverte');
  };

  return (
    <div className={overlay} onClick={onClose}>
      <div className={card} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-3">{isAr ? 'ملصقات الرفوف' : 'Étiquettes Rayon'}</h3>
        <input className={input} placeholder={isAr ? 'بحث...' : 'Rechercher...'} value={q} onChange={e => setQ(e.target.value)} />
        <div className="max-h-40 overflow-y-auto mt-2 space-y-1">
          {filtered.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-[11px] text-slate-200 bg-[#0b0f17] border border-[#233145] rounded-lg px-2 py-1.5 cursor-pointer">
              <input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="truncate">{p.name_fr} <span className="text-slate-500 font-mono">{p.barcode}</span></span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <button disabled={!sel.length} className={`${btn} bg-[#1e293b] hover:bg-[#2b3a4f] text-white`} onClick={doPreview}>{isAr ? 'معاينة A4' : 'Aperçu A4'} ({sel.length})</button>
          <button disabled={!sel.length} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`} onClick={doPrint80}>{isAr ? 'طبع حراري 80مم' : 'Imprimer 80mm'}</button>
          <button className={`${btn} bg-transparent text-slate-400 hover:text-white`} onClick={onClose}>{isAr ? 'إغلاق' : 'Fermer'}</button>
        </div>
        {msg && <div className="text-[11px] text-slate-300 mt-2">{msg}</div>}
        {html && <iframe title="labels" className="w-full h-64 mt-3 bg-white rounded-lg" srcDoc={html} />}
      </div>
    </div>
  );
};

/** ADR-018: shrinkage ledger — pure local decrement + localStorage journal. */
const LOSS_REASONS = ['EXPIRED', 'BROKEN', 'DAMAGED', 'THEFT', 'INTERNAL_USE', 'AUTRE'] as const;
const LOSS_JOURNAL_KEY = 'baraka_losses_v1';

export const LossModal: React.FC<{
  isAr: boolean; products: Product[]; onClose: () => void;
  onLossRecorded: (productId: number, qtyUnits: number) => void;
}> = ({ isAr, products, onClose, onLossRecorded }) => {
  const [productId, setProductId] = useState<number>(products[0]?.id ?? 0);
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<string>('EXPIRED');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');

  const submit = () => {
    const q = Number(qty);
    if (!productId || !(q > 0)) { setMsg(isAr ? 'كمية غير صالحة' : 'Quantité invalide'); return; }
    onLossRecorded(productId, q);
    try {
      const raw = localStorage.getItem(LOSS_JOURNAL_KEY);
      const journal = raw ? JSON.parse(raw) as unknown[] : [];
      journal.push({ product_id: productId, qty_units: q, reason, notes: notes || null, at: new Date().toISOString() });
      localStorage.setItem(LOSS_JOURNAL_KEY, JSON.stringify(journal.slice(-500)));
    } catch { /* private mode — state already updated */ }
    setMsg(isAr ? 'تم تسجيل الخسارة محلياً' : 'Perte enregistrée (local)');
  };

  return (
    <div className={overlay} onClick={onClose}>
      <div className={`${card} max-w-lg`} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-3">{isAr ? 'إعلان خسارة / كسر' : 'Déclarer Perte / Casse'}</h3>
        <div className="space-y-3">
          <select className={input} value={productId} onChange={e => setProductId(Number(e.target.value))}>
            {products.map(p => <option key={p.id} value={p.id}>{p.name_fr} — {p.barcode}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input className={`${input} font-mono`} type="number" min="0" step="0.001" value={qty} onChange={e => setQty(e.target.value)} placeholder={isAr ? 'الكمية' : 'Quantité'} />
            <select className={input} value={reason} onChange={e => setReason(e.target.value)}>
              {LOSS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <input className={input} value={notes} onChange={e => setNotes(e.target.value)} placeholder={isAr ? 'ملاحظات (اختياري)' : 'Notes (optionnel)'} />
        </div>
        <div className="flex gap-2 mt-3">
          <button className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`} onClick={submit}>{isAr ? 'تسجيل الخسارة' : 'Enregistrer'}</button>
          <button className={`${btn} bg-transparent text-slate-400 hover:text-white`} onClick={onClose}>{isAr ? 'إغلاق' : 'Fermer'}</button>
        </div>
        {msg && <div className="text-[11px] text-slate-300 mt-2">{msg}</div>}
      </div>
    </div>
  );
};

/** ADR-018: local snapshot export/import — the offline backup lane. */
const SNAPSHOT_KEYS = ['baraka_products_v2', 'baraka_clients_v2', 'baraka_suppliers_v2', 'baraka_sales_v2', 'baraka_purchases_v2', 'baraka_settlements_v2', 'baraka_supplier_payments_v2', 'baraka_store_v2', LOSS_JOURNAL_KEY];

export const snapshotLocalState = (): string => {
  const snap: Record<string, unknown> = { app: 'baraka-market', exportedAt: new Date().toISOString() };
  for (const k of SNAPSHOT_KEYS) {
    try {
      const v = localStorage.getItem(k);
      snap[k] = v ? JSON.parse(v) : null;
    } catch { snap[k] = null; }
  }
  return JSON.stringify(snap);
};

export const restoreLocalSnapshot = (json: string): string[] => {
  const snap = JSON.parse(json) as Record<string, unknown>;
  if (!snap || snap.app !== 'baraka-market') throw new Error('not a baraka snapshot');
  const restored: string[] = [];
  for (const [k, v] of Object.entries(snap)) {
    if (k === 'app' || k === 'exportedAt' || v == null) continue;
    localStorage.setItem(k, JSON.stringify(v));
    restored.push(k);
  }
  return restored;
};

export const LocalSnapshotPanel: React.FC<{ isAr: boolean }> = ({ isAr }) => {
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob([snapshotLocalState()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `baraka-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(isAr ? 'تم تنزيل النسخة المحلية' : 'Snapshot local téléchargé');
  };

  const doImport = async (f: File) => {
    try {
      const keys = restoreLocalSnapshot(await f.text());
      setMsg((isAr ? 'تمت الاستعادة — أعد التحميل: ' : 'Restauré — rechargez: ') + keys.length + (isAr ? ' مفاتيح' : ' clés'));
    } catch (e) {
      setMsg(`${isAr ? 'ملف غير صالح: ' : 'Fichier invalide: '}${(e as Error).message}`);
    }
  };

  return (
    <div className="bg-[#101724] border border-[#1e293b] rounded-xl p-4">
      <h3 className="text-xs font-bold text-white mb-1">{isAr ? 'نسخة محلية (تعمل دون خادم)' : 'Snapshot local (sans serveur)'}</h3>
      <p className="text-[11px] text-slate-500 mb-3">{isAr ? 'تنزيل/استعادة كاملة لحالة التطبيق من المتصفح.' : 'Export/import complet de l’état applicatif depuis le navigateur.'}</p>
      <div className="flex gap-2">
        <button className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`} onClick={doExport}>{isAr ? 'تنزيل نسخة' : 'Exporter'}</button>
        <button className={`${btn} bg-[#1e293b] hover:bg-[#2b3a4f] text-white`} onClick={() => fileRef.current?.click()}>{isAr ? 'استعادة من ملف' : 'Restaurer'}</button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ''; }} />
      </div>
      {msg && <div className="text-[11px] text-slate-300 mt-2">{msg}</div>}
    </div>
  );
};
