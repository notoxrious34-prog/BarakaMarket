/**
 * C3 (PLAN-v1.2.0): credit-ceiling consumption bar — pure math + tone.
 * green <70% · amber <100% · red at/over (blocked by the ADR-012 gate).
 * Unlimited ceiling (limit<=0) reports full=null so the bar hides.
 */
export type CeilingTone = 'green' | 'amber' | 'red' | 'none';

export interface CeilingBar { pct: number | null; tone: CeilingTone }

export function ceilingBar(balanceCt: number, limitCt: number): CeilingBar {
  if (limitCt <= 0) return { pct: null, tone: 'none' };
  const pct = Math.min(100, Math.max(0, Math.round((balanceCt / limitCt) * 100)));
  return { pct, tone: pct >= 100 ? 'red' : pct >= 70 ? 'amber' : 'green' };
}

export const CEILING_TONE_CLASS: Record<Exclude<CeilingTone, 'none'>, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-rose-500',
};
