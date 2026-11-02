import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatDZD } from '../../core/display';

const API = 'http://127.0.0.1:3100';

interface LiveStatus {
  session: { id: string; cashierName: string; openedAt: string };
  openingFloatCt: number; cashSalesCt: number; settlementsCashCt: number;
  depositsCt: number; withdrawalsCt: number; expensesCt: number;
  theoreticalCashCt: number; totalSalesCount: number;
}

interface ZResult {
  zNumber: string; theoreticalCashCt: number; closingCountedCt: number;
  cashDiffCt: number; hash: string;
}

export const CashSessionsView: React.FC = () => {
  const { language, session } = useApp();
  const isAr = language === 'ar';
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [cashier, setCashier] = useState(session?.displayName ?? 'Amine');
  const [opening, setOpening] = useState('5000');
  const [movType, setMovType] = useState<'DEPOSIT' | 'WITHDRAWAL' | 'EXPENSE'>('DEPOSIT');
  const [movAmount, setMovAmount] = useState('');
  const [movReason, setMovReason] = useState('');
  const [counted, setCounted] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [lastZ, setLastZ] = useState<ZResult | null>(null);
  const [msg, setMsg] = useState('');

  // B4: live gap = counted − theoretical, computed before anything closes.
  const countedCt = counted.trim() === '' ? null : Math.round(Number(counted) * 100);
  const liveDiffCt = live && countedCt !== null && Number.isFinite(countedCt) ? countedCt - live.theoreticalCashCt : null;
  const closeBlocked = liveDiffCt !== null && liveDiffCt !== 0 && closeReason.trim() === '';

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/cash/active`);
      if (!r.ok) throw new Error();
      setLive(await r.json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const post = async (url: string, body: unknown, okMsg: string) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'error');
      setMsg(okMsg);
      setLastZ(j.zNumber ? j as ZResult : null);
      await refresh();
    } catch (e) {
      setMsg(`${isAr ? 'خطأ: ' : 'Erreur: '}${(e as Error).message}`);
    }
  };

  const dz = (ct: number) => formatDZD(ct / 100);
  const card = 'bg-[#101724] border border-[#1e293b] rounded-xl p-4';
  const input = 'w-full bg-[#162030] border border-[#2b3a4f] rounded-lg px-3 py-1.5 text-xs text-white';
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors';

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <h2 className="text-sm font-bold text-white">{isAr ? 'إغلاق الصندوق وتقرير Z' : 'Caisse & Clôture (Z)'}</h2>
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
            onClick={() => void post(`${API}/api/cash/open`, { cashierName: cashier, openingFloatCt: Math.round(Number(opening) * 100) }, isAr ? 'تم فتح الجلسة' : 'Session ouverte')}
          >
            {isAr ? 'فتح الجلسة' : 'Ouvrir'}
          </button>
        </div>
      ) : (
        <>
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-emerald-300">{isAr ? 'الجلسة الحالية' : 'Session en cours'}</h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-bold">OPEN</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div><span className="text-slate-500 block">{isAr ? 'الكاشير' : 'Caissier'}</span><span className="text-white font-semibold">{live.session.cashierName}</span></div>
              <div><span className="text-slate-500 block">{isAr ? 'الافتتاح' : 'Fond'}</span><span className="text-white font-mono">{dz(live.openingFloatCt)}</span></div>
              <div><span className="text-slate-500 block">{isAr ? 'مبيعات نقدية' : 'Ventes espèces'}</span><span className="text-white font-mono">{dz(live.cashSalesCt)}</span></div>
              <div><span className="text-slate-500 block">{isAr ? 'النظري' : 'Théorique'}</span><span className="text-emerald-300 font-mono font-bold">{dz(live.theoreticalCashCt)}</span></div>
              <div><span className="text-slate-500 block">{isAr ? 'تحصيل ديون' : 'Encaissé créances'}</span><span className="text-white font-mono">{dz(live.settlementsCashCt)}</span></div>
              <div><span className="text-slate-500 block">{isAr ? 'إيداع/سحب/مصاريف' : 'Dépôt/Retrait/Dép.'}</span><span className="text-white font-mono">{dz(live.depositsCt)} / {dz(live.withdrawalsCt)} / {dz(live.expensesCt)}</span></div>
              <div><span className="text-slate-500 block">{isAr ? 'الفواتير' : 'Tickets'}</span><span className="text-white font-mono">{live.totalSalesCount}</span></div>
            </div>
          </div>

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
              onClick={() => void post(`${API}/api/cash/movement`, { sessionId: live.session.id, movementType: movType, amountCt: Math.round(Number(movAmount) * 100), reason: movReason || '-' }, isAr ? 'تم تسجيل الحركة' : 'Mouvement enregistré')}
            >
              {isAr ? 'تسجيل' : 'Enregistrer'}
            </button>
          </div>

          <div className={card}>
            <h3 className="text-xs font-bold text-amber-300 mb-3">{isAr ? 'الإغلاق وتقرير Z' : 'Clôture & Rapport Z'}</h3>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'النظري (متوقع)' : 'Théorique (attendu)'}</label>
                <div className="font-mono text-sm text-emerald-300 font-bold" dir="ltr">{live ? dz(live.theoreticalCashCt) : '—'}</div>
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'النقد المحسوب (دج)' : 'Espèces comptées (DZD)'}</label>
                <input className={`${input} font-mono`} type="number" value={counted} onChange={e => setCounted(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-slate-400 block mb-1">{isAr ? 'الفرق المباشر' : 'Écart en direct'}</label>
                <div className={`font-mono text-sm font-bold ${liveDiffCt === null ? 'text-slate-500' : liveDiffCt === 0 ? 'text-emerald-300' : liveDiffCt > 0 ? 'text-amber-300' : 'text-rose-300'}`} dir="ltr">
                  {liveDiffCt === null ? '—' : `${dz(liveDiffCt)}${liveDiffCt === 0 ? (isAr ? ' مثالي' : ' PARFAIT') : liveDiffCt > 0 ? (isAr ? ' فائض' : ' EXCÉDENT') : (isAr ? ' عجز' : ' DÉFICIT')}`}
                </div>
              </div>
            </div>
            {/* B4: a non-zero gap closes ONLY with a written reason (goes to notes + z.close audit). */}
            {(liveDiffCt !== null && liveDiffCt !== 0) && (
              <div className="mt-2">
                <label className="text-[11px] text-amber-300 block mb-1">{isAr ? 'سبب الفرق (إلزامي للإغلاق)' : 'Motif de l’écart (obligatoire) :'}</label>
                <input className={input} value={closeReason} onChange={e => setCloseReason(e.target.value)} placeholder={isAr ? 'مثال: فرق صرف، خطأ عد...' : 'Ex : erreur de rendu, différence de comptage…'} />
              </div>
            )}
            <div className="flex gap-3 items-end mt-2">
              <button
                className={`${btn} ${closeBlocked ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                disabled={closeBlocked}
                title={closeBlocked ? (isAr ? 'اكتب سبب الفرق أولاً' : 'Motif requis d’abord') : undefined}
                onClick={() => {
                  if (!live || countedCt === null) { setMsg(isAr ? 'أدخل المبلغ المحسوب أولاً' : 'Saisissez le compté d’abord'); return; }
                  void post(`${API}/api/cash/close-and-z`, { sessionId: live.session.id, countedCashCt: countedCt, notes: closeReason.trim() || undefined, printReceipt: true, actor: session?.username ?? cashier }, isAr ? 'تم الإغلاق وطبع Z' : 'Clôturé — Z imprimé');
                }}
              >
                {isAr ? 'إغلاق وطبع Z' : 'Clôturer + Z'}
              </button>
            </div>
            {lastZ && (
              <div className="mt-3 text-[11px] bg-[#0b0f17] border border-[#2b3a4f] rounded-lg p-3 font-mono">
                <div className="text-white font-bold">{lastZ.zNumber}</div>
                <div className={lastZ.cashDiffCt === 0 ? 'text-emerald-300' : lastZ.cashDiffCt > 0 ? 'text-amber-300' : 'text-rose-300'}>
                  {isAr ? 'الفرق: ' : 'Écart: '}{dz(lastZ.cashDiffCt)} {lastZ.cashDiffCt === 0 ? (isAr ? 'مثالي' : 'PARFAIT') : lastZ.cashDiffCt > 0 ? (isAr ? 'فائض' : 'EXCÉDENT') : (isAr ? 'عجز' : 'DÉFICIT')}
                </div>
                <div className="text-slate-500 break-all">hash {lastZ.hash.slice(0, 32)}…</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
