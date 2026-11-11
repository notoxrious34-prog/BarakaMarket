import React, { memo } from 'react';
import { RefreshCw, PackageSearch } from 'lucide-react';
import { CLAIM_REASONS } from '../../types/index';
import type { ClaimReasonCode, ClaimResolution, ClaimStatus } from '../../types/index';
import type { ClaimHead, QuarantineRow } from '../../core/claims-authority';
import { formatDZDFromCt } from '../../core/display';
import { fmtUnitQty, CLAIM_REASON_LABEL, CLAIM_RES_LABEL } from './returns-panels-shared';

/**
 * MKT-006 island 03 — quarantine + supplier claims over it.
 * Memo on the claims slice only.
 */
export interface ClaimSupplier {
  id: number; name: string;
}

export interface ReturnClaimsPanelProps {
  isAr: boolean;
  quar: QuarantineRow[];
  claims: ClaimHead[];
  busy: boolean;
  canClaim: boolean;
  canSettleClaim: boolean;
  claimFilter: '' | ClaimStatus;
  onClaimFilter: (f: '' | ClaimStatus) => void;
  onRefreshClaims: () => void;
  claimFor: number | null;
  onClaimFor: (i: number | null) => void;
  claimSupplier: string;
  onClaimSupplier: (v: string) => void;
  claimReason: ClaimReasonCode;
  onClaimReason: (r: ClaimReasonCode) => void;
  claimNote: string;
  onClaimNote: (v: string) => void;
  onClaim: (q: QuarantineRow) => void;
  settleId: string | null;
  onSettleId: (id: string | null) => void;
  settleRes: ClaimResolution;
  onSettleRes: (r: ClaimResolution) => void;
  onSettleClaim: (id: string) => void;
  suppliers: ClaimSupplier[];
}

export const ReturnClaimsPanel: React.FC<ReturnClaimsPanelProps> = memo(function ReturnClaimsPanel(p) {
  const { isAr } = p;
  return (
    <section className="bg-[#111722] border border-[#1e293b] rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25">03</span>
        <PackageSearch className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-black text-slate-200">
          {isAr ? 'الحجر الصحي والمطالبات (المورّدون)' : 'Quarantaine & réclamations'}
        </h3>
        <button type="button" onClick={p.onRefreshClaims}
          className="ms-auto p-2 rounded-lg border border-[#2b3a4f] text-slate-300 hover:text-white" title={isAr ? 'تحديث' : 'Actualiser'}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {p.quar.length === 0 && (
        <p className="text-xs text-slate-500">{isAr ? 'لا سلع محجوزة حالياً.' : 'Rien en quarantaine.'}</p>
      )}
      {p.quar.map((q, i) => (
        <div key={`${q.return_number}-${i}`} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-black text-slate-100">{q.name_fr}</span>
            <span className="font-mono text-amber-300" dir="ltr">{fmtUnitQty(q.qty_milli, q.unit)} {q.unit}</span>
            <span className="text-slate-500 font-mono" dir="ltr">{q.return_number}</span>
          </div>
          {p.canClaim && p.claimFor === i ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select value={p.claimSupplier} onChange={e => p.onClaimSupplier(e.target.value)}
                className="bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-amber-500">
                <option value="">{isAr ? '— المورّد —' : '— Fournisseur —'}</option>
                {p.suppliers.map(s => <option key={s.id} value={s.id}>{s.name} #{s.id}</option>)}
              </select>
              <select value={p.claimReason} onChange={e => p.onClaimReason(e.target.value as ClaimReasonCode)}
                className="bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-amber-500">
                {CLAIM_REASONS.map(r => <option key={r} value={r}>{isAr ? CLAIM_REASON_LABEL[r].ar : CLAIM_REASON_LABEL[r].fr}</option>)}
              </select>
              <input value={p.claimNote} onChange={e => p.onClaimNote(e.target.value)} maxLength={140}
                placeholder={isAr ? 'ملاحظة (اختيارية)' : 'Note (optionnelle)'}
                className="sm:col-span-2 bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-2 text-xs placeholder:text-slate-600 focus:outline-none focus:border-amber-500" />
              <div className="sm:col-span-2 flex gap-2">
                <button type="button" onClick={() => p.onClaim(q)} disabled={p.busy}
                  className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-bold">
                  {isAr ? 'تسجيل المطالبة' : 'Créer la réclamation'}
                </button>
                <button type="button" onClick={() => p.onClaimFor(null)}
                  className="px-3 py-2 rounded-lg border border-[#2b3a4f] text-slate-300 text-xs font-bold">
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
              </div>
            </div>
          ) : (
            p.canClaim && (
              <button type="button" onClick={() => { p.onClaimFor(i); p.onClaimSupplier(''); p.onClaimNote(''); p.onClaimReason('DEFECT'); }}
                className="px-3 py-1.5 rounded-lg border border-amber-700 text-amber-300 hover:bg-amber-950 text-xs font-bold">
                {isAr ? 'مطالبة المورّد' : 'Réclamer au fournisseur'}
              </button>
            )
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        {(['', 'OPEN', 'SETTLED'] as const).map(f => (
          <button key={f} type="button" onClick={() => p.onClaimFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${p.claimFilter === f ? 'bg-amber-600 text-white' : 'bg-[#0b0f17] text-slate-400 border border-[#2b3a4f]'}`}>
            {f === '' ? (isAr ? 'كل المطالبات' : 'Toutes') : f === 'OPEN' ? (isAr ? 'مفتوحة' : 'Ouvertes') : (isAr ? 'مسواة' : 'Soldées')}
          </button>
        ))}
      </div>
      {p.claims.map(c => (
        <div key={c.id} className="bg-[#0b0f17] border border-[#2b3a4f] rounded-xl p-3 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-mono font-black text-amber-300" dir="ltr">{c.claim_number}</span>
            <span className="font-bold text-slate-100">{c.supplier_name}</span>
            <span className="text-slate-400">{c.product_name} · <span className="font-mono" dir="ltr">{fmtUnitQty(c.qty_milli, c.unit)}</span></span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-black ${c.status === 'OPEN' ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'}`}>
              {c.status === 'OPEN' ? (isAr ? 'مفتوحة' : 'Ouverte') : (isAr ? 'مسواة' : 'Soldée')}
            </span>
            {c.status === 'SETTLED' && c.resolution && (
              <span className="text-slate-500 text-[11px]">{isAr ? CLAIM_RES_LABEL[c.resolution as ClaimResolution].ar : CLAIM_RES_LABEL[c.resolution as ClaimResolution].fr}</span>
            )}
            <span className="text-slate-500 font-mono" dir="ltr">{formatDZDFromCt(c.total_cost_ct)}</span>
          </div>
          {c.status === 'OPEN' && p.canSettleClaim && (p.settleId === c.id ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={p.settleRes} onChange={e => p.onSettleRes(e.target.value as ClaimResolution)}
                className="bg-[#111722] border border-[#2b3a4f] rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-amber-500">
                {(['CREDIT_NOTE', 'REPLACED', 'REFUNDED', 'REJECTED'] as const).map(r => (
                  <option key={r} value={r}>{isAr ? CLAIM_RES_LABEL[r].ar : CLAIM_RES_LABEL[r].fr}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button type="button" onClick={() => p.onSettleClaim(c.id)} disabled={p.busy}
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold">
                  {isAr ? 'تأكيد التسوية' : 'Solder'}
                </button>
                <button type="button" onClick={() => p.onSettleId(null)}
                  className="px-3 py-2 rounded-lg border border-[#2b3a4f] text-slate-300 text-xs font-bold">
                  {isAr ? 'إلغاء' : 'Annuler'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { p.onSettleId(c.id); p.onSettleRes('CREDIT_NOTE'); }}
              className="px-3 py-1.5 rounded-lg border border-emerald-700 text-emerald-300 hover:bg-emerald-950 text-xs font-bold">
              {isAr ? 'تسوية' : 'Solder'}
            </button>
          ))}
        </div>
      ))}
    </section>
  );
});
