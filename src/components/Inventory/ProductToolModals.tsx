import React, { useState } from 'react';
import { Product } from '../../types';

const API = 'http://127.0.0.1:3100';
const card = 'bg-[#101724] border border-[#1e293b] rounded-2xl p-4 w-full max-w-2xl max-h-[85vh] overflow-y-auto';
const input = 'w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors disabled:opacity-40';
const overlay = 'fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4';

const OfflineNote: React.FC<{ isAr: boolean }> = ({ isAr }) => (
  <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3">
    {isAr ? 'الخادم المحلي غير متصل — شغّل `npm run dev:server`.' : 'Loopback hors ligne — lancez `npm run dev:server`.'}
  </div>
);

/** ADR-009: bulk CSV importer — paste, dry-run preflight, atomic commit. */
export const CsvImportModal: React.FC<{ isAr: boolean; onClose: () => void }> = ({ isAr, onClose }) => {
  const [csv, setCsv] = useState('barcode;name_fr;sell_price_ct;tva_rate\n6130000000015;HUILE ELIO 5L;65000;0');
  const [preview, setPreview] = useState<{ summary: { total: number; valid: number; errorsCount: number }; preview: Record<string, unknown>[]; errors: string[] } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const doPreview = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`${API}/api/products/import-preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csvText: csv }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'error');
      setPreview(j); setOffline(false);
    } catch (e) { setOffline(true); setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const doExecute = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/products/import-execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: preview.preview, mode: 'UPSERT' }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'error');
      setMsg(isAr ? `تم: ${j.inserted ?? j.upserted ?? '?'} منتج` : `Commis: ${JSON.stringify(j)}`);
      await doPreview();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className={overlay} onClick={onClose}>
      <div className={card} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-3">{isAr ? 'استيراد CSV بالجملة' : 'Importer CSV (vrac)'}</h3>
        {offline && <OfflineNote isAr={isAr} />}
        <textarea className={`${input} font-mono h-28`} value={csv} onChange={e => setCsv(e.target.value)} dir="ltr" />
        <div className="flex gap-2 mt-3">
          <button disabled={busy} className={`${btn} bg-[#1e293b] hover:bg-[#2b3a4f] text-white`} onClick={() => void doPreview()}>{isAr ? 'معاينة' : 'Prévisualiser'}</button>
          <button disabled={busy || !preview} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`} onClick={() => void doExecute()}>{isAr ? 'تنفيذ UPSERT' : 'Exécuter (UPSERT)'}</button>
          <button className={`${btn} bg-transparent text-slate-400 hover:text-white`} onClick={onClose}>{isAr ? 'إغلاق' : 'Fermer'}</button>
        </div>
        {msg && <div className="text-[11px] text-slate-300 mt-2 break-all">{msg}</div>}
        {preview && (
          <div className="mt-3 text-[11px]">
            <div className="text-slate-300 mb-1">total {preview.summary.total} · valides {preview.summary.valid} · erreurs {preview.summary.errorsCount}</div>
            {preview.errors.slice(0, 5).map((e, i) => <div key={i} className="text-rose-300">{e}</div>)}
            {preview.preview.slice(0, 10).map((row, i) => (
              <div key={i} className="text-slate-400 font-mono truncate">{JSON.stringify(row).slice(0, 120)}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** ADR-010: shelf-edge labels — pick products, A4 preview, 80mm thermal spool. */
export const ShelfLabelsDialog: React.FC<{ isAr: boolean; products: Product[]; onClose: () => void }> = ({ isAr, products, onClose }) => {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [html, setHtml] = useState('');
  const [msg, setMsg] = useState('');
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const filtered = products.filter(p => `${p.name_fr} ${p.name_ar} ${p.barcode}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);

  const toggle = (id: number) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const run = async (kind: 'preview' | 'print') => {
    if (!sel.length) return;
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`${API}/api/labels/${kind === 'preview' ? 'preview-html' : 'print-thermal'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productIds: sel }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'error');
      if (kind === 'preview') setHtml(j.html);
      else setMsg(isAr ? `تم إرسال ${j.count} ملصق (${j.bytes} بايت)` : `${j.count} étiquettes spoolées (${j.bytes} o)`);
      setOffline(false);
    } catch (e) { setOffline(true); setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className={overlay} onClick={onClose}>
      <div className={card} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-3">{isAr ? 'ملصقات الرفوف' : 'Étiquettes Rayon'}</h3>
        {offline && <OfflineNote isAr={isAr} />}
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
          <button disabled={busy || !sel.length} className={`${btn} bg-[#1e293b] hover:bg-[#2b3a4f] text-white`} onClick={() => void run('preview')}>{isAr ? 'معاينة A4' : 'Aperçu A4'} ({sel.length})</button>
          <button disabled={busy || !sel.length} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`} onClick={() => void run('print')}>{isAr ? 'طبع حراري 80مم' : 'Imprimer 80mm'}</button>
          <button className={`${btn} bg-transparent text-slate-400 hover:text-white`} onClick={onClose}>{isAr ? 'إغلاق' : 'Fermer'}</button>
        </div>
        {msg && <div className="text-[11px] text-slate-300 mt-2">{msg}</div>}
        {html && <iframe title="labels" className="w-full h-64 mt-3 bg-white rounded-lg" srcDoc={html} />}
      </div>
    </div>
  );
};

/** ADR-006: shrinkage ledger — expired/damaged write-off with local sync. */
const LOSS_REASONS = ['EXPIRED', 'BROKEN', 'DAMAGED', 'THEFT', 'INTERNAL_USE', 'AUTRE'] as const;

export const LossModal: React.FC<{
  isAr: boolean; products: Product[]; onClose: () => void;
  onLossRecorded: (productId: number, qtyUnits: number) => void;
}> = ({ isAr, products, onClose, onLossRecorded }) => {
  const [productId, setProductId] = useState<number>(products[0]?.id ?? 0);
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<string>('EXPIRED');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const q = Number(qty);
    if (!productId || !(q > 0)) { setMsg(isAr ? 'كمية غير صالحة' : 'Quantité invalide'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`${API}/api/losses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product_id: productId, qty_milli: Math.round(q * 1000), reason, notes: notes || null }) });
      const j = await r.json();
      if (!r.ok && r.status !== 201) throw new Error(j.error ?? 'error');
      onLossRecorded(productId, q);
      setOffline(false);
      setMsg(isAr ? 'تم تسجيل الخسارة' : 'Perte enregistrée');
    } catch (e) { setOffline(true); setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className={overlay} onClick={onClose}>
      <div className={`${card} max-w-lg`} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-3">{isAr ? 'إعلان خسارة / كسر' : 'Déclarer Perte / Casse'}</h3>
        {offline && <OfflineNote isAr={isAr} />}
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
          <button disabled={busy} className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`} onClick={() => void submit()}>{isAr ? 'تسجيل الخسارة' : 'Enregistrer'}</button>
          <button className={`${btn} bg-transparent text-slate-400 hover:text-white`} onClick={onClose}>{isAr ? 'إغلاق' : 'Fermer'}</button>
        </div>
        {msg && <div className="text-[11px] text-slate-300 mt-2">{msg}</div>}
      </div>
    </div>
  );
};
