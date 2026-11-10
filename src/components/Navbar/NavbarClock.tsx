import React, { memo, useEffect, useState } from 'react';
import { formatCashierClock } from '../../core/cashier-clock';

/**
 * TASK-MKT-003: the live till clock owns its own 1s tick in a memoized
 * island — Navbar (tabs, badges, session, outbox) no longer re-renders
 * every second. Same markup/classes as the inline version it replaces.
 */
interface NavbarClockProps {
  isAr: boolean;
}

export const NavbarClock: React.FC<NavbarClockProps> = memo(function NavbarClock({ isAr }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const { clock, dayStamp } = formatCashierClock(now);
  return (
    <span
      className="px-2.5 py-1.5 bg-[#162030] border border-[#2b3a4f] rounded-lg text-xs text-slate-200 flex items-center gap-1.5 tabular-nums"
      dir="ltr"
      title={isAr ? 'ساعة الصندوق' : 'Heure de caisse'}
    >
      <span className="font-semibold">{clock}</span>
      <span className="text-slate-500">•</span>
      <span className="text-slate-400">{dayStamp}</span>
    </span>
  );
});
