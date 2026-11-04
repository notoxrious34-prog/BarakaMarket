/** P2 (v1.4.4): pure payroll math — advances netted against monthly salary.
 * All money is integer centimes; no floats, no dates beyond YYYY-MM strings. */

/** Advances taken during the month that count against payday. */
export function advancesForMonth(
  advances: { workerId: number; date: string; amountCt: number }[],
  workerId: number,
  month: string, // YYYY-MM
): number {
  return advances
    .filter(a => a.workerId === workerId && a.date.startsWith(month))
    .reduce((s, a) => s + a.amountCt, 0);
}

/** Payday split: pay base − advances; excess advances carry as worker debt. */
export function settleSalaryMath(
  baseSalaryCt: number,
  advancesCt: number,
): { netPaidCt: number; carryCt: number } {
  if (!Number.isInteger(baseSalaryCt) || baseSalaryCt < 0) throw new Error('[salary] bad base');
  if (!Number.isInteger(advancesCt) || advancesCt < 0) throw new Error('[salary] bad advances');
  const netPaidCt = Math.max(0, baseSalaryCt - advancesCt);
  const carryCt = Math.max(0, advancesCt - baseSalaryCt);
  return { netPaidCt, carryCt };
}

/** Worker balance after an advance (receivable grows) or a payday (clears). */
export function applyAdvanceToBalance(balanceCt: number, amountCt: number): number {
  if (!Number.isInteger(amountCt) || amountCt <= 0) throw new Error('[advance] bad amount');
  return balanceCt + amountCt;
}

export function applyPaydayToBalance(balanceCt: number, settledAdvancesCt: number): number {
  return Math.max(0, balanceCt - settledAdvancesCt);
}
