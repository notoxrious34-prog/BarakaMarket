import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatDZD } from '../../core/display';
import {
  cashActiveNative, cashCloseNative, cashMoveNative, cashMovementsNative,
  cashOpenNative, cashSessionsNative,
} from '../../core/fiscal-authority';
import {
  loadCashSnapshot,
  type CashCloseResult, type CashLiveStatus,
  type CashMovementRow, type CashSessionRow,
} from '../../core/cash-snapshot';
import { useAsyncResource } from '../../core/use-async';
import { CloseSummaryPanel } from './CloseSummaryPanel';
import { CashCountPanel } from './CashCountPanel';

export const CashSessionsView: React.FC = () => {
  const { language, session } = useApp();
  const isAr = language === 'ar';
  // MKT-010: live/history/offline/movements come from the shared snapshot
  // resource below (no local fossils).
  // F6 (v1.4.5): no hardcoded fallback — the till refuses to open nameless (K5).
  const [cashier, setCashier] = useState(session?.displayName ?? '');
  const [opening, setOpening] = useState('5000');
  const [movType, setMovType] = useState<'DEPOSIT' | 'WITHDRAWAL' | 'EXPENSE'>('DEPOSIT');
  const [movAmount, setMovAmount] = useState('');
  const [movReason, setMovReason] = useState('');
  const [counted, setCounted] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [lastZ, setLastZ] = useState<CashCloseResult | null>(null);
  const [msg, setMsg] = useState('');

  // MKT-010: the till snapshot is a shared async resource — one loader,
  // one stale-race guard; the button + the 5s poller share `reload`.
  // v1.4.6 (#PROD-CASH): invoke-first, loopback second. The installed app
  // has no :3100 — the native lane IS the till there.
  // v1.4.6-fix: `cash_active` returns null when NO session is open — that is
  // a legitimate till state, NOT an outage. The lane probe is the history
  // call (always an array when the lane answers); `offline` survives only
  // when both lanes are down (dev preview without server).
  const lane = useMemo(() => ({
    sessions: (limit: number) => cashSessionsNative(limit),
    movements: (sessionId: string, limit: number) => cashMovementsNative(sessionId, limit),
    active: () => cashActiveNative(),
  }), []);
  const snap = useAsyncResource(() => loadCashSnapshot(lane), [lane]);
  useEffect(() => {
    // K1: poll while mounted — POS sales land from another tab/process, and the
    // B4 gap must compare a fresh theoretical, never a mount-time fossil.
    const t = setInterval(() => { void snap.reload(); }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const live: CashLiveStatus | null = snap.data?.active ?? null;
  const history: CashSessionRow[] = snap.data?.history ?? [];
  const movements: CashMovementRow[] = snap.data?.movements ?? [];
  const offline = snap.data ? !snap.data.laneAlive : false;
  const reload = snap.reload;

  // B4: live gap = counted − theoretical, computed before anything closes.
  const countedCt = counted.trim() === '' ? null : Math.round(Number(counted) * 100);
  const liveDiffCt = live && countedCt !== null && Number.isFinite(countedCt) ? countedCt - live.theoreticalCashCt : null;
  const closeBlocked = liveDiffCt !== null && liveDiffCt !== 0 && closeReason.trim() === '';

  /** K14/F4: guarded close — the island renders, the shell decides. */
  const handleCloseShift = (): void => {
    // F4 (institutional audit): negative counts never reach the server.
    if (!live || countedCt === null) { setMsg(isAr ? 'أدخل المبلغ المحسوب أولاً' : 'Saisissez le compté d’abord'); return; }
    if (countedCt < 0) { setMsg(isAr ? 'المبلغ المحسوب لا يكون سالباً' : 'Le compté ne peut pas être négatif'); return; }
    // K14: irreversible legal act — the cashier confirms with eyes open.
    const ok = window.confirm(isAr
      ? `إغلاق نهائي للجلسة؟ النظري ${dz(live.theoreticalCashCt)} — المحسوب ${dz(countedCt)}. لا رجوع بعد الطبع.`
      : `Clôture définitive ? Théorique ${dz(live.theoreticalCashCt)} — compté ${dz(countedCt)}. Irréversible après impression.`);
    if (!ok) return;
    void post('/cash/close-and-z', { sessionId: live.session.id, countedCashCt: countedCt, notes: closeReason.trim() || undefined, printReceipt: true, actor: session?.username ?? cashier }, isAr ? 'تم الإغلاق وطبع Z' : 'Clôturé — Z imprimé');
  };

  // v1.4.6 (#PROD-CASH): invoke-first writes. The loopback token relay is
  // gone — the native lane owns the guards (F3/F4/K5/K14) in the installed
  // app, the loopback owns them in browser dev. Same `post(url, body, okMsg)`
  // call shape, so the JSX below is untouched.
  const post = async (url: string, body: Record<string, unknown>, okMsg: string) => {
    try {
      let j: unknown = null;
      if (url.endsWith('/cash/open')) {
        j = await cashOpenNative(String(body.cashierName ?? ''), Number(body.openingFloatCt ?? 0));
      } else if (url.endsWith('/cash/movement')) {
        j = await cashMoveNative(
          String(body.sessionId ?? ''), String(body.movementType ?? ''),
          Number(body.amountCt ?? 0), String(body.reason ?? ''),
        );
      } else if (url.endsWith('/cash/close-and-z')) {
        j = await cashCloseNative(
          String(body.sessionId ?? ''), Number(body.countedCashCt ?? 0),
          typeof body.notes === 'string' ? body.notes : undefined,
        );
      }
      if (!j) throw new Error('CASH_LANE_DOWN');
      setMsg(okMsg);
      // K11: a movement response carries no zNumber — never wipe the last Z.
      if ((j as CashCloseResult).zNumber) {
        setLastZ(j as CashCloseResult);
        // K10: a real close retires the close form (no stale counted/reason).
        setCounted(''); setCloseReason('');
      } else if (url.endsWith('/cash/movement')) {
        setMovAmount(''); setMovReason('');
      }
      await reload();
    } catch (e) {
      // No native lane and no loopback: dev preview without server, or
      // a shell older than v1.4.6. Honest, in the user's language (P0 unified).
      const { friendlyLaneError } = await import('../../core/lane-error');
      setMsg(friendlyLaneError((e as Error).message || 'CASH_LANE_DOWN', isAr));
    }
  };

  const dz = (ct: number) => formatDZD(ct / 100);
  const card = 'bg-[#101724] border border-[#1e293b] rounded-xl p-4';
  const input = 'w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white';
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors';

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">{isAr ? 'إغلاق الصندوق وتقرير Z' : 'Caisse & Clôture (Z)'}</h2>
        <button
          className={`${btn} bg-[#1e293b] hover:bg-[#2b3a4f] text-slate-300`}
          onClick={() => void reload()}
          title={isAr ? 'تحديث الأرقام الحيّة' : 'Actualiser'}
        >
          {isAr ? 'تحديث' : 'Actualiser'}
        </button>
      </div>
      {offline && (
        <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          {isAr ? 'وضع مستقل: الجلسات المباشرة غير متوفرة هنا — تُدار من دفتر اليومية.' : 'Mode autonome: sessions live indisponibles ici — voir le journal comptable.'}
        </div>
      )}
      {msg && <div className="text-[11px] text-slate-300 bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-2">{msg}</div>}

      {!live ? (
        <div className={card}>
          <h3 className="text-xs font-bold text-emerald-300 mb-3">{isAr ? 'فتح جلسة صندوق' : 'Ouvrir une session'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الكاشير' : 'Caissier'}</label>
              <input className={input} value={cashier} onChange={e => setCashier(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الصندوق الافتتاحي (دج)' : 'Fond de caisse (DZD)'}</label>
              <input className={`${input} font-mono`} type="number" value={opening} onChange={e => setOpening(e.target.value)} />
            </div>
          </div>
          <button
            className={`${btn} mt-3 bg-emerald-600 hover:bg-emerald-500 text-white`}
            onClick={() => {
              // K5: the server stays the judge, but the obvious garbage never leaves.
              const f = Math.round(Number(opening) * 100);
              if (!cashier.trim()) { setMsg(isAr ? 'اكتب اسم الكاشير أولاً' : 'Nom du caissier requis'); return; }
              if (opening.trim() === '' || !Number.isFinite(f) || f < 0) { setMsg(isAr ? 'الصندوق الافتتاحي رقم ≥ 0' : 'Fond de caisse : nombre ≥ 0'); return; }
              void post('/cash/open', { cashierName: cashier.trim(), openingFloatCt: f }, isAr ? 'تم فتح الجلسة' : 'Session ouverte');
            }}
          >
            {isAr ? 'فتح الجلسة' : 'Ouvrir'}
          </button>
        </div>
      ) : (
        <>
          {/* MKT-010 island: live till summary. */}
          {live && <CloseSummaryPanel live={live} isAr={isAr} dz={dz} />}

          <div className={card}>
            <h3 className="text-xs font-bold text-slate-200 mb-3">{isAr ? 'حركة وسط اليوم' : 'Mouvement de caisse'}</h3>
            <div className="grid grid-cols-3 gap-3">
              <select className={input} value={movType} onChange={e => setMovType(e.target.value as typeof movType)}>
                <option value="DEPOSIT">{isAr ? 'إيداع' : 'Dépôt'}</option>
                <option value="WITHDRAWAL">{isAr ? 'سحب' : 'Retrait'}</option>
                <option value="EXPENSE">{isAr ? 'مصروف' : 'Dépense'}</option>
              </select>
              <input className={`${input} font-mono`} type="number" placeholder={isAr ? 'المبلغ (دج)' : 'Montant (DZD)'} value={movAmount} onChange={e => setMovAmount(e.target.value)} />
              <input className={input} placeholder={isAr ? 'السبب' : 'Motif'} value={movReason} onChange={e => setMovReason(e.target.value)} />
            </div>
            <button
              className={`${btn} mt-3 bg-[#1e293b] hover:bg-[#2b3a4f] text-white`}
              onClick={() => {
                // F3 (institutional audit): '-' is not a reason — require real text.
                if (!movReason.trim() || !movAmount.trim() || !(Number(movAmount) > 0)) {
                  setMsg(isAr ? 'اكتب المبلغ (> 0) وسبباً حقيقياً للحركة أولاً' : 'Saisissez un montant (> 0) et un motif réel d’abord');
                  return;
                }
                void post('/cash/movement', { sessionId: live.session.id, movementType: movType, amountCt: Math.round(Number(movAmount) * 100), reason: movReason.trim() }, isAr ? 'تم تسجيل الحركة' : 'Mouvement enregistré');
              }}
            >
              {isAr ? 'تسجيل' : 'Enregistrer'}
            </button>
          </div>

          {/* MKT-010 island: count + guarded close. */}
          {live && (
            <CashCountPanel
              live={live} isAr={isAr} dz={dz}
              counted={counted} onCounted={setCounted}
              closeReason={closeReason} onCloseReason={setCloseReason}
              liveDiffCt={liveDiffCt} closeBlocked={closeBlocked}
              lastZ={lastZ} onClose={handleCloseShift}
            />
          )}

        </>
      )}
      {/* F8 (v1.4.5): the movement trail — every dinar in/out carries its reason. */}
      <div className={card}>
        <h3 className="text-xs font-bold text-slate-300 mb-2">{isAr ? 'سجل الحركات' : 'Mouvements de caisse'}</h3>
        {movements.length === 0 ? (
          <p className="text-[11px] text-slate-500">{isAr ? 'لا حركات مسجلة بعد في هذه الجلسة.' : 'Aucun mouvement sur cette session.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500 text-start border-b border-[#2b3a4f]">
                  <th className="py-1 font-semibold">{isAr ? 'الوقت' : 'Heure'}</th>
                  <th className="py-1 font-semibold">{isAr ? 'النوع' : 'Type'}</th>
                  <th className="py-1 font-semibold">{isAr ? 'السبب' : 'Motif'}</th>
                  <th className="py-1 font-semibold text-end" dir="ltr">{isAr ? 'المبلغ' : 'Montant'}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id} className="border-b border-[#1a2432] text-slate-300">
                    <td className="py-1.5 font-mono text-slate-400" dir="ltr">{m.createdAt.slice(11, 16)}</td>
                    <td className="py-1.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${m.type === 'DEPOSIT'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : m.type === 'WITHDRAWAL'
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                          : 'bg-rose-500/10 text-rose-300 border-rose-500/30'}`}>
                        {m.type}
                      </span>
                    </td>
                    <td className="py-1.5">{m.reason || '—'}</td>
                    <td className="py-1.5 font-mono text-end font-bold" dir="ltr">{dz(m.amountCt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* K9: the page no longer ends at the live row — past shifts stay visible. */}
      {history.length > 0 && (
        <div className={card}>
          <h3 className="text-xs font-bold text-slate-300 mb-2">{isAr ? 'سجل الجلسات' : 'Historique des sessions'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500 text-start border-b border-[#2b3a4f]">
                  <th className="py-1 font-semibold">{isAr ? 'الكاشير' : 'Caissier'}</th>
                  <th className="py-1 font-semibold">{isAr ? 'الحالة' : 'Statut'}</th>
                  <th className="py-1 font-semibold">Z</th>
                  <th className="py-1 font-semibold text-end" dir="ltr">{isAr ? 'الفرق' : 'Écart'}</th>
                  <th className="py-1 font-semibold text-end" dir="ltr">{isAr ? 'النظري' : 'Théorique'}</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-b border-[#1a2432] text-slate-300">
                    <td className="py-1.5 font-semibold text-white">{h.cashierName}</td>
                    <td className="py-1.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${h.status === 'OPEN'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : 'bg-slate-500/10 text-slate-400 border-slate-500/30'}`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="py-1.5 font-mono text-slate-400">{h.zReportId ?? '—'}</td>
                    <td className={`py-1.5 font-mono text-end font-bold ${(h.cashDiffCt ?? 0) === 0 ? 'text-emerald-300' : (h.cashDiffCt ?? 0) > 0 ? 'text-amber-300' : 'text-rose-300'}`} dir="ltr">
                      {h.cashDiffCt === undefined ? '—' : dz(h.cashDiffCt)}
                    </td>
                    <td className="py-1.5 font-mono text-end" dir="ltr">{h.theoreticalCashCt === undefined ? '—' : dz(h.theoreticalCashCt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
