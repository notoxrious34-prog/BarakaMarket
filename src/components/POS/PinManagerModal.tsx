import React, { memo, useMemo, useState } from 'react';
import { Pin, Plus, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { auditSessionEvent } from '../../core/session-authority.js';
import { setPinLane } from '../../core/pin-authority.js';
import { upsertProductsNative } from '../../core/product-authority';
import type { Product } from '../../types';

/**
 * ADR-053 P3 — owner pin board. Create codeless articles (NULL barcode),
 * assign/evict slots #1..#12, POIDS prix/kg (Q4), track toggle (Q3).
 * Control #2 (anti-fake): a NAME that scans as a barcode (digits ≥ 6)
 * raises a warning and forces an explicit override checkbox; the override
 * is stamped into the audit detail. Every mutation audits pin.assign /
 * pin.unpin / pin.create with the actor.
 */
interface Props {
  onClose: () => void;
}

const SLOTS = Array.from({ length: 12 }, (_, i) => i + 1);

function looksLikeBarcode(s: string): boolean {
  return /^\d{6,}$/.test(s.replace(/[\s-]/g, ''));
}

export const PinManagerModal: React.FC<Props> = memo(function PinManagerModal({ onClose }) {
  const { products, addProduct, updateProduct, refreshPins, session } = useApp();
  const isOwner = session?.role === 'owner';
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // create form
  const [showCreate, setShowCreate] = useState(false);
  const [nameFr, setNameFr] = useState('');
  const [kind, setKind] = useState<'PIECE' | 'POIDS' | 'LIBRE'>('PIECE');
  const [price, setPrice] = useState('');
  const [perKg, setPerKg] = useState('');
  const [slot, setSlot] = useState<number | ''>('');
  const [track, setTrack] = useState(false);
  const [overrideFake, setOverrideFake] = useState(false);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = [...products].sort((a, b) => (a.pin_order ?? 99) - (b.pin_order ?? 99) || a.name_fr.localeCompare(b.name_fr));
    if (!t) return all.slice(0, 60);
    return all.filter((p) => p.name_fr.toLowerCase().includes(t) || (p.barcode ?? '').includes(t)).slice(0, 60);
  }, [products, q]);

  if (!isOwner) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="rounded-2xl bg-slate-900 border border-slate-700 p-5 text-slate-200 font-bold" onClick={(e) => e.stopPropagation()}>
          Réservé au gérant (pin.assign requiert le rôle owner).
        </div>
      </div>
    );
  }

  const actor = session?.username ?? 'owner';

  const doPin = async (p: Product, order: number | null) => {
    setErr(null);
    setBusy(`pin-${p.id}`);
    try {
      const r = await setPinLane(p.id, { pin_order: order });
      if (!r) throw new Error('lanes down — DB injoignable');
      updateProduct(p.id, { pin_order: r.pin_order });
      await auditSessionEvent(actor, order == null ? 'pin.unpin' : 'pin.assign', `#${order ?? '—'} ${p.name_fr} (id ${p.id})`);
      await refreshPins();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doCreate = async () => {
    setErr(null);
    const name = nameFr.trim();
    if (!name) { setErr('Nom requis'); return; }
    const fake = looksLikeBarcode(name);
    if (fake && !overrideFake) { setErr('Ce nom ressemble à un code-barres — cochez la confirmation explicite (contrôle anti-faux #2).'); return; }
    const sell = Math.round(parseFloat(price || '0') * 100) / 100;
    if (!(sell > 0)) { setErr('Prix de vente requis'); return; }
    let perKgNum: number | undefined;
    if (kind === 'POIDS') {
      perKgNum = Math.round(parseFloat(perKg || '0') * 100) / 100;
      if (!(perKgNum > 0)) { setErr('POIDS exige un prix/kg explicite du gérant (Q4).'); return; }
    }
    if (slot !== '' && (slot < 1 || slot > 12)) { setErr('Emplacement 1..12'); return; }
    setBusy('create');
    try {
      const created = addProduct({
        barcode: '', name_fr: name, name_ar: name, category_id: 'codeless',
        buy_price: 0, sell_price: kind === 'POIDS' ? (perKgNum as number) : sell,
        tva_rate: 0, stock_qty: 0, min_stock_alert: 0, unit: 'PIECE',
        has_expiry_date: false, expiry_date: '',
        kind, price_per_kg: kind === 'POIDS' ? perKgNum : undefined,
        pin_order: slot === '' ? null : slot, track_stock: track,
      });
      const payload = { ...created, barcode: '', price_per_kg: kind === 'POIDS' ? perKgNum : undefined };
      void upsertProductsNative([payload]);
      if (slot !== '') {
        const r = await setPinLane(created.id, {
          pin_order: slot, kind, price_per_kg_ct: kind === 'POIDS' ? Math.round((perKgNum as number) * 100) : null,
          track_stock: track ? 1 : 0,
        });
        if (!r) throw new Error('lanes down — article créé localement, épinglage à reprendre');
        updateProduct(created.id, { pin_order: r.pin_order });
      }
      await auditSessionEvent(actor, 'pin.create', `${name} kind=${kind} slot=${slot === '' ? '—' : `#${slot}`}${fake ? ' override:fake-barcode' : ''}`);
      await refreshPins();
      setNameFr(''); setPrice(''); setPerKg(''); setSlot(''); setOverrideFake(false); setShowCreate(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-2xl border border-sky-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Épinglage articles (gérant)"
      >
        <div className="flex items-center justify-between p-3 border-b border-slate-700">
          <span className="font-black text-sky-200 flex items-center gap-2"><Pin className="w-4 h-4" /> Épinglage — 12 emplacements</span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3 flex gap-2 border-b border-slate-800">
          <div className="relative flex-1">
            <Search className="absolute start-2 top-2.5 w-4 h-4 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher article…"
              className="w-full rounded-xl border border-slate-600 bg-slate-800 ps-8 pe-2 py-2 text-sm text-white" />
          </div>
          <button onClick={() => setShowCreate((v) => !v)}
            className="rounded-xl bg-sky-700 px-3 py-2 text-sm font-black text-white hover:bg-sky-600 flex items-center gap-1">
            <Plus className="w-4 h-4" /> Sans code
          </button>
        </div>
        {showCreate && (
          <div className="p-3 border-b border-amber-700/50 bg-amber-950/20 grid grid-cols-2 gap-2">
            <input value={nameFr} onChange={(e) => setNameFr(e.target.value)} placeholder="Nom (ex: OEUF — PAS de code)"
              className="col-span-2 rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white" />
            <select value={kind} onChange={(e) => setKind(e.target.value as 'PIECE' | 'POIDS' | 'LIBRE')}
              className="rounded-xl border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-white">
              <option value="PIECE">PIECE — prix fixe</option>
              <option value="POIDS">POIDS — prix/kg (Q4)</option>
              <option value="LIBRE">LIBRE — prix libre</option>
            </select>
            <select value={slot} onChange={(e) => setSlot(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              className="rounded-xl border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-white">
              <option value="">Emplacement…</option>
              {SLOTS.map((s) => <option key={s} value={s}>#{s}</option>)}
            </select>
            <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Prix (دج)"
              inputMode="decimal" className="rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white font-mono" dir="ltr" />
            <input value={perKg} onChange={(e) => setPerKg(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={kind === 'POIDS' ? 'Prix/kg (OBLIGATOIRE)' : 'Prix/kg (—)'}
              inputMode="decimal" disabled={kind !== 'POIDS'}
              className="rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white font-mono disabled:opacity-40" dir="ltr" />
            <label className="col-span-2 flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} />
              Suivre le stock (sinon: vente jamais bloquée, Q3)
            </label>
            {looksLikeBarcode(nameFr) && (
              <label className="col-span-2 flex items-start gap-2 rounded-xl border border-red-600/60 bg-red-950/30 p-2 text-xs text-red-200">
                <input type="checkbox" checked={overrideFake} onChange={(e) => setOverrideFake(e.target.checked)} className="mt-0.5" />
                ⚠ Ce nom ressemble à un code-barres. Je confirme que l'article est VRAIMENT sans code (contrôle #2 — tracé en audit).
              </label>
            )}
            <button onClick={() => void doCreate()} disabled={busy === 'create'}
              className="col-span-2 rounded-xl bg-emerald-600 py-2 font-black text-white hover:bg-emerald-500 disabled:opacity-50">
              {busy === 'create' ? '…' : 'Créer + épingler ✓'}
            </button>
          </div>
        )}
        {err && <div className="px-3 pt-2 text-xs font-bold text-red-300">{err}</div>}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {rows.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-800/60">
              <span className="w-8 shrink-0 rounded bg-sky-800/70 text-center font-mono text-xs font-black text-sky-100" dir="ltr">
                {p.pin_order ? `#${p.pin_order}` : '—'}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-sm font-bold text-slate-100">{p.name_fr}</span>
                <span className="block text-[10px] font-mono text-slate-500" dir="ltr">
                  {(p.barcode ?? '') === '' ? 'sans code' : p.barcode} · {p.kind ?? 'PIECE'}{p.kind === 'POIDS' ? ` · ${p.price_per_kg ?? p.sell_price}/kg` : ''}",
                </span>
              </span>
              <select
                value={p.pin_order ?? ''}
                disabled={busy === `pin-${p.id}`}
                onChange={(e) => void doPin(p, e.target.value === '' ? null : parseInt(e.target.value, 10))}
                className="rounded-lg border border-slate-600 bg-slate-800 px-1.5 py-1 text-xs text-white font-mono"
                aria-label={`Emplacement ${p.name_fr}`}
              >
                <option value="">—</option>
                {SLOTS.map((s) => <option key={s} value={s}>#{s}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="p-2 border-t border-slate-700 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">Un emplacement = une tuile · l'assignation évince l'ancien occupant</span>
          <span className="text-[11px] text-slate-500 font-mono" dir="ltr">#N · Q*#N · Alt+1..9</span>
        </div>
      </div>
    </div>
  );
});
