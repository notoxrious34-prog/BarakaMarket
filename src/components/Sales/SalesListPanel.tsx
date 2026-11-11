import React, { memo } from 'react';
import { Receipt, Undo2 } from 'lucide-react';
import { formatDZDFromCt } from '../../core/display';
import { EMPTY_SALES_BOOK_FILTERS, type SalesBookRow } from '../../core/sales-book-authority';

/**
 * SalesListPanel.tsx — MKT-007 island (verbatim from SalesBookView §02).
 * The master list: column header, states, receipt rows with flags.
 */

export const PAY_LABEL: Record<string, { ar: string; fr: string }> = {
  ESPECES: { ar: 'نقدًا', fr: 'Espèces' },
  CIB: { ar: 'CIB', fr: 'CIB' },
  DAHABIYA: { ar: 'ذهبية', fr: 'Dahabiya' },
  CREDIT: { ar: 'كريدي', fr: 'Crédit' },
};

const timeOf = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

interface Props {
  filtered: SalesBookRow[] | null;
  rows: SalesBookRow[] | null;
  err: string | null;
  selectedId: string | null;
  isAr: boolean;
  onOpen: (id: string) => void;
  onClearFilters: () => void;
}

export const SalesListPanel: React.FC<Props> = memo(function SalesListPanel({
  filtered, rows, err, selectedId, isAr, onOpen, onClearFilters,
}: Props) {
  return (
    <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">02</span>
        <Receipt className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-black text-white">{isAr ? 'وصولات اليوم — اختر وصلًا' : 'Tickets du jour — choisissez'}</h3>
        {filtered && (
          <span className="ms-auto text-[11px] font-bold text-slate-400" dir="ltr">{filtered.length}</span>
        )}
      </div>
      {/* Column header (desktop): mirrors the UltraPOS desk. */}
      <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_64px_minmax(0,1fr)_86px_64px_minmax(0,0.8fr)] gap-2 px-3 text-[11px] font-black text-slate-500 uppercase tracking-wide" dir="ltr">
        <span className={isAr ? 'text-right' : 'text-left'}>{isAr ? 'الوصل' : 'N° document'}</span>
        <span className="text-center">{isAr ? 'الساعة' : 'Heure'}</span>
        <span>{isAr ? 'الكاشير / الزبون' : 'Caissier / Client'}</span>
        <span>{isAr ? 'الدفع' : 'Paiement'}</span>
        <span className="text-center">{isAr ? 'أسطر' : 'Articles'}</span>
        <span className="text-end">{isAr ? 'المجموع' : 'Total TTC'}</span>
      </div>
      <div className="space-y-2 max-h-[62vh] overflow-y-auto pe-1" data-testid="sales-list">
      {rows === null && !err && <p className="text-xs text-slate-500">{isAr ? 'جارٍ التحميل…' : 'Chargement…'}</p>}
      {rows && rows.length === 0 && (
        <p className="text-xs text-slate-500 border border-dashed border-[#2b3a4f] rounded-xl px-3 py-4 text-center">
          {isAr ? 'لا مبيعات في هذا اليوم.' : 'Aucune vente ce jour.'}
        </p>
      )}
      {filtered && filtered.length === 0 && rows && rows.length > 0 && (
        <p className="text-xs text-slate-500 border border-dashed border-[#2b3a4f] rounded-xl px-3 py-4 text-center">
          {isAr ? 'لا نتائج بهذه الفلاتر.' : 'Aucun résultat avec ces filtres.'}{' '}
          <button type="button" onClick={onClearFilters} className="underline text-emerald-400">
            {isAr ? 'مسح الفلاتر' : 'Effacer les filtres'}
          </button>
        </p>
      )}
      {filtered?.map(r => {
        const active = r.id === selectedId;
        return (
        <button key={r.id} type="button" onClick={() => onOpen(r.id)}
          aria-current={active}
          className={`w-full rounded-xl px-3 py-2.5 text-sm text-start cursor-pointer border transition-colors grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_64px_minmax(0,1fr)_86px_64px_minmax(0,0.8fr)] gap-x-2 gap-y-1 items-center ${active ? 'bg-emerald-600/10 border-emerald-500/60' : 'bg-[#0b0f17] border-[#2b3a4f] hover:border-emerald-500/50'}`}>
          <span className="min-w-0">
            <span className="block font-mono font-bold text-emerald-300 truncate" dir="ltr">{r.invoice_number}</span>
            <span className="block text-xs text-slate-500 truncate">{r.cashier_name}{r.client_name ? ` · ${r.client_name}` : ''}</span>
          </span>
          <span className="md:hidden font-bold text-white font-mono tabular-nums" dir="ltr">{formatDZDFromCt(r.total_ttc_ct)}</span>
          <span className="hidden md:block font-mono text-slate-400 text-xs" dir="ltr">{timeOf(r.created_at)}</span>
          <span className="hidden md:block text-xs text-slate-400 truncate">{r.cashier_name}{r.client_name ? <span className="text-slate-500"> · {r.client_name}</span> : ''}</span>
          <span className="hidden md:flex text-xs text-slate-400 items-center gap-1">
            {PAY_LABEL[r.payment_method]?.[isAr ? 'ar' : 'fr'] ?? r.payment_method}
            {r.status !== 'COMPLETED' && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-900 text-red-200">
                {isAr ? 'ملغاة' : 'ANNULÉE'}
              </span>
            )}
            {r.has_approved_return === 1 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-900 text-amber-200 inline-flex items-center gap-0.5">
                <Undo2 className="w-2.5 h-2.5" /> AVOIR
              </span>
            )}
          </span>
          <span className="hidden md:block text-center font-mono text-slate-300 text-xs" dir="ltr">{r.item_count}</span>
          <span className="hidden md:block text-end font-bold text-white font-mono tabular-nums" dir="ltr">{formatDZDFromCt(r.total_ttc_ct)}</span>
        </button>
        );
      })}
      </div>
    </section>
  );
});
