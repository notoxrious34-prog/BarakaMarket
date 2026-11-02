import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, describeKey, effectiveCombos,
  resetShortcuts, setShortcut, type ShortcutAction,
} from '../../core/shortcuts';
import { Keyboard, RotateCcw } from 'lucide-react';

const LABELS: Record<ShortcutAction, { ar: string; fr: string }> = {
  'pos.search': { ar: 'بحث/باركود', fr: 'Recherche' },
  'pos.qty': { ar: 'الكمية', fr: 'Quantité' },
  'pos.discount': { ar: 'التخفيض', fr: 'Remise' },
  'pos.hold': { ar: 'تعليق السلة', fr: 'Suspendre' },
  'pos.recall': { ar: 'استرجاع', fr: 'Rappeler' },
  'pos.scale': { ar: 'الميزان', fr: 'Balance' },
  'pos.filter': { ar: 'فلترة', fr: 'Filtre' },
  'pos.credit': { ar: 'كريدي', fr: 'Crédit' },
  'pos.settle': { ar: 'التسوية', fr: 'Encaisser' },
  'pos.checkout': { ar: 'الدفع السريع', fr: 'Checkout' },
  'pos.lock': { ar: 'القفل', fr: 'Verrou' },
  'pay.exact': { ar: 'المبلغ بالضبط', fr: 'Exact' },
  'pay.1000': { ar: '1000 دج', fr: '1000 DA' },
  'pay.2000': { ar: '2000 دج', fr: '2000 DA' },
  'pay.5000': { ar: '5000 دج', fr: '5000 DA' },
};

/**
 * C5: remap UI — click a row, press the new key, conflicts refused inline.
 * Overrides persist in localStorage and survive reload (guard-tested).
 */
export const ShortcutsSettingsView: React.FC = () => {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [combos, setCombos] = useState(() => effectiveCombos(localStorage));
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(() => setCombos(effectiveCombos(localStorage)), []);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      const combo = describeKey(e);
      const r = setShortcut(localStorage, recording, combo);
      if (r.ok) {
        setMsg('');
      } else {
        setMsg(isAr ? `مرفوض: ${combo} مستعمل لـ ${LABELS[r.conflict].ar}` : `Refusé : ${combo} déjà pris par ${LABELS[r.conflict].fr}`);
      }
      setRecording(null);
      refresh();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, refresh, isAr]);

  return (
    <div className="bg-[#111722] border border-[#1e293b] rounded-2xl p-5 space-y-3">
      <h3 className="text-sm font-bold text-white flex items-center gap-2">
        <Keyboard className="w-4 h-4 text-amber-400" />
        <span>{isAr ? 'تخصيص اختصارات لوحة المفاتيح' : 'Raccourcis clavier personnalisés'}</span>
      </h3>
      <p className="text-[11px] text-slate-400">
        {isAr
          ? 'انقر على زر ثم اضغط المفتاح الجديد. المفاتيح الهيكلية (Enter/Escape/2/3) ثابتة. التعارض داخل نفس الوضع مرفوض.'
          : 'Cliquez puis pressez la nouvelle touche. Enter/Échap/2/3 restent fixes. Conflit intra-mode refusé.'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {SHORTCUT_ACTIONS.map(a => {
          const isDefault = DEFAULT_SHORTCUTS[a].includes(combos[a][0]);
          return (
            <button
              key={a}
              onClick={() => { setRecording(a); setMsg(''); }}
              className={`flex items-center justify-between px-3 py-1.5 rounded-xl border text-xs cursor-pointer transition-colors ${recording === a ? 'border-amber-400 bg-amber-500/10 text-amber-200' : 'border-[#2b3a4f] bg-[#162030] text-slate-200 hover:border-slate-500'}`}
            >
              <span>{isAr ? LABELS[a].ar : LABELS[a].fr} <span className="text-slate-500 font-mono text-[10px]">{a}</span></span>
              <span className={`font-mono font-bold px-2 py-0.5 rounded ${isDefault ? 'bg-[#0b0f17] text-slate-300' : 'bg-emerald-950 text-emerald-300'}`}>
                {recording === a ? '…' : combos[a][0] === ' ' ? 'Space' : combos[a][0]}
              </span>
            </button>
          );
        })}
      </div>
      {msg && <p className="text-xs text-rose-300">{msg}</p>}
      <button
        onClick={() => { resetShortcuts(localStorage); refresh(); setMsg(isAr ? 'أُعيدت الافتراضيات' : 'Défauts restaurés'); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#162030] border border-[#2b3a4f] text-slate-300 hover:text-white cursor-pointer"
      >
        <RotateCcw className="w-3.5 h-3.5" /> {isAr ? 'استعادة الافتراضيات' : 'Restaurer défauts'}
      </button>
    </div>
  );
};
