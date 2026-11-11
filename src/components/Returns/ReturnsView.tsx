import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../core/rbac';
import { formatDZDFromCt } from '../../core/display';
import { friendlyLaneError } from '../../core/lane-error';
import { RETURN_TWO_PERSON_THRESHOLD_CT, DEFAULT_DISPOSITION } from '../../types/index';
import type { ReturnReasonCode, ReturnStatus, ReturnDisposition, ClaimReasonCode, ClaimResolution } from '../../types/index';
import {
  lookupReturnSale, createReturnDraft, approveReturn, rejectReturn, getReturn,
  listReturns, lastReturnLaneError,
} from '../../core/returns-authority';
import type { ReturnHead, ReturnSaleLookup } from '../../core/returns-authority';
import {
  createSupplierClaim, settleSupplierClaim, listSupplierClaims, listQuarantineRows,
  lastClaimLaneError,
} from '../../core/claims-authority';
import type { ClaimHead, QuarantineRow } from '../../core/claims-authority';
import { ReturnThermalTicket } from '../Receipts/ReturnThermalTicket';
import { ReturnLookupPanel } from './ReturnLookupPanel';
import { ReturnDraftsPanel } from './ReturnDraftsPanel';
import { ReturnClaimsPanel } from './ReturnClaimsPanel';
import { RotateCcw } from 'lucide-react';

/* Labels/helpers moved verbatim to ./returns-panels-shared (MKT-006). */

/** Lane refusal → cashier-facing message (P0: unified in core/lane-error). */
function mapReturnError(raw: string | null, isAr: boolean): string {
  return friendlyLaneError(raw, isAr);
}

const toMilli = (v: number, unit: string): number =>
  unit === 'PIECE' ? Math.round(v) * 1000 : Math.round(v);

/**
 * v1.5.0 — Returns desk. Lookup by FACT → draft (cashier+) → approve/reject
 * (manager+) → BON DE RETOUR. All guards live lane-side; the view only gates
 * buttons by role and translates refusals.
 */
export const ReturnsView: React.FC = () => {
  const { session, language, suppliers } = useApp();
  const isAr = language === 'ar';

  const [lookupKey, setLookupKey] = useState('');
  const [lookup, setLookup] = useState<ReturnSaleLookup | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [reason, setReason] = useState<ReturnReasonCode>('DEFECT');
  const [reasonNote, setReasonNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [filter, setFilter] = useState<'' | ReturnStatus>('');
  const [rows, setRows] = useState<ReturnHead[]>([]);
  const [listing, setListing] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [ticket, setTicket] = useState<(ReturnHead & { items: Record<string, unknown>[] }) | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [approveItems, setApproveItems] = useState<{ id: number; name_fr: string; qty_milli: number; unit: string }[]>([]);
  const [disp, setDisp] = useState<Record<number, ReturnDisposition>>({});

  // R-bridge: quarantine held for the rep + the claims filed over it.
  const [quar, setQuar] = useState<QuarantineRow[]>([]);
  const [claims, setClaims] = useState<ClaimHead[]>([]);
  const [claimFilter, setClaimFilter] = useState<'' | 'OPEN' | 'SETTLED'>('');
  const [claimFor, setClaimFor] = useState<number | null>(null);
  const [claimSupplier, setClaimSupplier] = useState('');
  const [claimReason, setClaimReason] = useState<ClaimReasonCode>('DEFECT');
  const [claimNote, setClaimNote] = useState('');
  const [settleId, setSettleId] = useState<string | null>(null);
  const [settleRes, setSettleRes] = useState<ClaimResolution>('CREDIT_NOTE');
  const refreshClaims = useCallback(async () => {
    const [q, c] = await Promise.all([
      listQuarantineRows(),
      listSupplierClaims(claimFilter || undefined),
    ]);
    if (q) setQuar(q);
    if (c) setClaims(c);
    else if (c === null) setMsg({ kind: 'err', text: mapReturnError(lastClaimLaneError(), isAr) });
  }, [claimFilter, isAr]);

  useEffect(() => { void refreshClaims(); }, [refreshClaims]);

  const refresh = useCallback(async () => {
    setListing(true);
    const list = await listReturns(filter || undefined);
    setListing(false);
    if (!list) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setRows(list);
  }, [filter, isAr]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!session) {
    return (
      <div className="p-6 text-center text-slate-400">
        {isAr ? 'سجّل الدخول أولاً.' : 'Connectez-vous d’abord.'}
      </div>
    );
  }
  const canCreate = can(session.role, 'returns.create');
  const canDecide = can(session.role, 'returns.approve');
  const canClaim = can(session.role, 'claims.create');
  const canSettleClaim = can(session.role, 'claims.settle');

  const doClaim = async (row: QuarantineRow) => {
    const sid = Number(claimSupplier);
    if (!Number.isInteger(sid) || sid <= 0) {
      setMsg({ kind: 'err', text: isAr ? 'اختر المورّد من القائمة' : 'Choisissez le fournisseur' });
      return;
    }
    const sup = suppliers.find(s => s.id === sid);
    setBusy(true);
    const out = await createSupplierClaim({
      supplier_id: sid, supplier_name: sup?.name ?? `#${sid}`,
      product_id: row.product_id, qty_milli: row.qty_milli,
      reason: claimReason, note: claimNote.trim() || undefined, actor: session.username,
    });
    setBusy(false);
    if (!out) { setMsg({ kind: 'err', text: mapReturnError(lastClaimLaneError(), isAr) }); return; }
    setClaimFor(null); setClaimSupplier(''); setClaimNote('');
    setMsg({ kind: 'ok', text: isAr ? `مطالبة ${out.claim_number} مسجلة` : `Réclamation ${out.claim_number} créée` });
    void refreshClaims();
  };

  const doSettleClaim = async (id: string) => {
    setBusy(true);
    const ok = await settleSupplierClaim(id, settleRes, session.username, session.role);
    setBusy(false);
    if (!ok) { setMsg({ kind: 'err', text: mapReturnError(lastClaimLaneError(), isAr) }); return; }
    setSettleId(null);
    setMsg({ kind: 'ok', text: isAr ? 'سُوّيت المطالبة' : 'Réclamation soldée' });
    void refreshClaims();
  };

  const doLookup = async () => {
    setLooking(true); setLookupMsg(null); setLookup(null); setPicked({});
    // Supermarket lane: forgive case, spaces and short digits before hitting
    // the DAL (which completes FACT-{year}-{pad6} and unique suffixes itself).
    const f = await lookupReturnSale(lookupKey.trim().toUpperCase().replace(/\s+/g, ''));
    setLooking(false);
    if (!f) { setLookupMsg(mapReturnError(lastReturnLaneError(), isAr)); return; }
    setLookup(f);
    // Preselect every returnable line at full remaining — untick to shrink.
    const pre: Record<number, number> = {};
    for (const it of f.items) {
      if (it.remaining_milli > 0) pre[it.sale_item_id] = it.unit === 'PIECE' ? it.remaining_milli / 1000 : it.remaining_milli;
    }
    setPicked(pre);
  };

  const doCreate = async () => {
    if (!lookup) return;
    // A4 (supermarket): OTHER without a note is refused lane-side too.
    if (reason === 'OTHER' && !reasonNote.trim()) {
      setMsg({ kind: 'err', text: mapReturnError('needs a note', isAr) });
      return;
    }
    const lines = Object.entries(picked)
      .map(([sid, v]) => ({ saleItemId: Number(sid), v }))
      .filter(e => Number.isFinite(e.v) && e.v > 0)
      .map(e => {
        const line = lookup.items.find(i => i.sale_item_id === e.saleItemId)!;
        return { saleItemId: e.saleItemId, qty_milli: toMilli(e.v, line.unit) };
      })
      .filter(l => l.qty_milli > 0);
    if (!lines.length) { setMsg({ kind: 'err', text: isAr ? 'اختر سطراً وكمية' : 'Choisissez ligne + quantité' }); return; }
    setBusy(true);
    const d = await createReturnDraft({
      sale_id: lookup.sale.id, lines, reason,
      reason_note: reasonNote.trim() || null, actor: session.username,
    });
    setBusy(false);
    if (!d) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setMsg({ kind: 'ok', text: isAr ? `مسودة محفوظة — مسترد ${formatDZDFromCt(d.refund_ct)} بانتظار المدير` : `Brouillon — ${formatDZDFromCt(d.refund_ct)} en attente manager` });
    setLookup(null); setLookupKey(''); setPicked({}); setReasonNote('');
    void refresh();
  };

  const openApprove = async (r: ReturnHead) => {
    const full = await getReturn(r.id);
    if (!full) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    const items = (full.items as unknown[]).map(it => {
      const o = it as { id?: number; name_fr?: string; qty_milli?: number; unit?: string };
      return { id: Number(o.id ?? 0), name_fr: String(o.name_fr ?? ''), qty_milli: Number(o.qty_milli ?? 0), unit: String(o.unit ?? 'PIECE') };
    }).filter(it => it.id > 0);
    const pre: Record<number, ReturnDisposition> = {};
    for (const it of items) pre[it.id] = DEFAULT_DISPOSITION[r.reason];
    setApproveItems(items);
    setDisp(pre);
    setApproveId(r.id);
  };

  const confirmApprove = async (r: ReturnHead) => {
    // Every line must carry a valid disposition before the money moves.
    if (approveItems.some(it => !disp[it.id])) {
      setMsg({ kind: 'err', text: isAr ? 'حدد مصير كل سطر' : 'Choisissez le sort de chaque ligne' });
      return;
    }
    setBusy(true);
    const out = await approveReturn(r.id, session.username, session.role, disp);
    setBusy(false);
    if (!out) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setMsg({ kind: 'ok', text: isAr ? `تم القبول ${out.return_number} — اطبع الوصل` : `Approuvé ${out.return_number} — imprimez le bon` });
    setApproveId(null);
    void refresh();
  };

  const doReject = async (id: string) => {
    setBusy(true);
    const ok = await rejectReturn(id, session.username, rejectNote.trim() || undefined);
    setBusy(false);
    setRejectId(null); setRejectNote('');
    if (!ok) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setMsg({ kind: 'ok', text: isAr ? 'رُفضت المسودة نهائياً' : 'Brouillon rejeté (définitif)' });
    void refresh();
  };

  const openTicket = async (id: string) => {
    const full = await getReturn(id);
    if (!full) { setMsg({ kind: 'err', text: mapReturnError(lastReturnLaneError(), isAr) }); return; }
    setTicket(full);
  };

  if (!session) {
    return (
      <div className="p-6 text-center text-slate-400">
        {isAr ? 'سجّل الدخول أولاً.' : 'Connectez-vous d’abord.'}
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="p-6 text-center text-slate-400">
        {isAr ? 'الإرجاع للصرّافين فما فوق.' : 'Retours réservés aux caissiers et +.'}
      </div>
    );
  }

  const selfApproveBlocked = (r: ReturnHead) =>
    canDecide && r.actor === session.username && r.refund_ct >= RETURN_TWO_PERSON_THRESHOLD_CT;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto text-slate-100">
      {/* Institutional hero — the 4-gate pipeline at a glance. */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[#111722] via-[#162030] to-[#111722] border border-[#1e293b] rounded-2xl p-5 md:p-6 shadow-2xl">
        <div aria-hidden={true} className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent" />
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
            <RotateCcw className="w-6 h-6 text-amber-400" />
          </span>
          <div>
            <h2 className="text-xl font-black text-white">{isAr ? 'مكتب الإرجاع' : 'Bureau des retours'}</h2>
            <p className="text-xs text-slate-400">{isAr ? 'بحث ذكي بالفاتورة ← مسودة ← قرار المدير ← وصل وحجر' : 'Recherche FACT intelligente → brouillon → décision → bon & quarantaine'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {[
            { n: '01', t: isAr ? 'بحث الفاتورة' : 'Recherche FACT' },
            { n: '02', t: isAr ? 'المسودات والقرارات' : 'Brouillons & décisions' },
            { n: '03', t: isAr ? 'الحجر والمطالبات' : 'Quarantaine & litiges' },
            { n: '04', t: isAr ? 'الوصل الحراري' : 'Bon thermique' },
          ].map(s => (
            <span key={s.n} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#0b0f17] border border-[#2b3a4f] text-slate-300">
              <span className="font-mono text-amber-400">{s.n}</span> {s.t}
            </span>
          ))}
        </div>
      </div>

      {msg && (
        <div className={`px-4 py-2.5 rounded-xl text-sm font-bold border ${msg.kind === 'ok' ? 'bg-emerald-950 border-emerald-800 text-emerald-200' : 'bg-red-950 border-red-800 text-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* 01 · Smart lookup — memo island (MKT-006). */}
      <ReturnLookupPanel
        isAr={isAr} lookupKey={lookupKey} onLookupKey={setLookupKey}
        lookup={lookup} lookupMsg={lookupMsg} looking={looking}
        picked={picked}
        onTogglePick={(saleItemId, checked, unit, remainingMilli) => setPicked(prev => {
          const n = { ...prev };
          if (checked) n[saleItemId] = unit === 'PIECE' ? remainingMilli / 1000 : remainingMilli;
          else delete n[saleItemId];
          return n;
        })}
        onPickQty={(saleItemId, v) => setPicked(prev => ({ ...prev, [saleItemId]: v }))}
        reason={reason} onReason={setReason} reasonNote={reasonNote} onReasonNote={setReasonNote}
        busy={busy} onLookup={() => void doLookup()} onCreate={() => void doCreate()}
      />

      {/* 02 · Drafts & decisions — memo island (MKT-006). */}
      <ReturnDraftsPanel
        isAr={isAr} rows={rows} listing={listing} filter={filter} onFilter={setFilter}
        onRefresh={() => void refresh()} busy={busy} canDecide={canDecide}
        isSelfApproveBlocked={selfApproveBlocked}
        rejectId={rejectId} rejectNote={rejectNote} onRejectNote={setRejectNote}
        onToggleReject={r => { setRejectId(rejectId === r.id ? null : r.id); setRejectNote(''); }}
        onReject={id => void doReject(id)}
        onOpenApprove={r => void openApprove(r)} onOpenTicket={id => void openTicket(id)}
        approveId={approveId} approveItems={approveItems} disp={disp}
        onDisp={(id, d) => setDisp(prev => ({ ...prev, [id]: d }))}
        onConfirmApprove={r => void confirmApprove(r)} onCancelApprove={() => setApproveId(null)}
      />

      {/* 03 · Quarantine + claims — memo island (MKT-006). */}
      <ReturnClaimsPanel
        isAr={isAr} quar={quar} claims={claims} busy={busy}
        canClaim={canClaim} canSettleClaim={canSettleClaim}
        claimFilter={claimFilter} onClaimFilter={setClaimFilter}
        onRefreshClaims={() => void refreshClaims()}
        claimFor={claimFor} onClaimFor={setClaimFor}
        claimSupplier={claimSupplier} onClaimSupplier={setClaimSupplier}
        claimReason={claimReason} onClaimReason={setClaimReason}
        claimNote={claimNote} onClaimNote={setClaimNote}
        onClaim={q => void doClaim(q)}
        settleId={settleId} onSettleId={setSettleId}
        settleRes={settleRes} onSettleRes={setSettleRes}
        onSettleClaim={id => void doSettleClaim(id)}
        suppliers={suppliers}
      />

      {ticket && (
        <ReturnThermalTicket
          ret={{
            return_number: ticket.return_number, invoice_number: ticket.invoice_number,
            posting_day: ticket.posting_day, reason: ticket.reason,
            reason_note: (ticket as unknown as { reason_note?: string | null }).reason_note ?? null,
            actor: ticket.actor, approver: ticket.approver, refund_ct: ticket.refund_ct,
            payment_method: ticket.payment_method,
            items: ticket.items.map(it => {
              const o = it as unknown as { name_fr?: string; qty_milli?: number; unit?: string; line_ttc_ct?: number };
              return { name_fr: String(o.name_fr ?? ''), qty_milli: Number(o.qty_milli ?? 0), unit: String(o.unit ?? 'PIECE'), line_ttc_ct: Number(o.line_ttc_ct ?? 0) };
            }),
          }}
          onClose={() => setTicket(null)}
        />
      )}
    </div>
  );
};
