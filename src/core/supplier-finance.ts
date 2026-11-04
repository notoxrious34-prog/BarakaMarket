/**
 * Baraka Market — supplier finance kernel (M-fixes, institutional audit).
 * Pure helpers for the supplier lane: BR numbering, payment guards, NIF.
 * Storage access is injected (localStorage in prod, Map-backed in tests).
 *
 * @module core/supplier-finance
 */

export interface SeqStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const BR_PREFIX = 'baraka_seq_BR_';
const pad4 = (n: number): string => String(n).padStart(4, '0');

/**
 * M1-fix: monotonic BR numbers that survive deletes/reloads.
 * First run seeds from the highest existing BR-<year>-XXXX suffix, then the
 * counter is the single source (never purchases.length-based).
 */
export function nextBRNumber(store: SeqStorage, year: number, existing: string[]): string {
  const key = `${BR_PREFIX}${year}`;
  let last = 0;
  try {
    last = parseInt(store.getItem(key) ?? '0', 10) || 0;
  } catch { last = 0; }
  if (last <= 0) {
    const re = new RegExp(`^BR-${year}-(\\d{4})$`);
    for (const inv of existing) {
      const m = re.exec((inv ?? '').trim());
      if (m) last = Math.max(last, parseInt(m[1], 10));
    }
  }
  const next = last + 1;
  try { store.setItem(key, String(next)); } catch { /* storage full — still monotonic in-memory */ }
  return `BR-${year}-${pad4(next)}`;
}

/** M4-fix: reception payment must stay inside [0, total]. */
export function validateReceptionPayment(totalTTC: number, amountPaid: number): void {
  if (!Number.isFinite(amountPaid) || amountPaid < 0) throw new Error('[reception] amount paid must be >= 0');
  if (!Number.isFinite(totalTTC) || totalTTC < 0) throw new Error('[reception] bad total');
  if (amountPaid - totalTTC > 0.005) throw new Error('[reception] overpayment refused — settle the remainder via supplier payment');
}

/** M4-fix: supplier settlement must stay inside (0, balance]. */
export function validateSupplierPayment(balanceDue: number, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('[supplier-pay] amount must be > 0');
  if (!Number.isFinite(balanceDue) || balanceDue < 0) throw new Error('[supplier-pay] bad balance');
  if (amount - balanceDue > 0.005) throw new Error('[supplier-pay] overpayment refused — amount exceeds the balance due');
}

/** M7-fix: Algerian NIF is exactly 15 digits (empty = not provided). */
export function isValidNIF(nif: string): boolean {
  const t = (nif ?? '').trim();
  if (t === '') return true;
  return /^\d{15}$/.test(t);
}
