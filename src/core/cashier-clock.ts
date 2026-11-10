/**
 * Baraka Market — cashier clock formatting (TASK-MKT-003).
 * Latin digits, explicit zero-padding — never locale-shaped (till reference).
 * Pure: all React timing lives in the memoized NavbarClock component.
 */
export interface CashierClockParts {
  /** HH:MM:SS (24h, latin, zero-padded). */
  clock: string;
  /** DD/MM (latin, zero-padded). */
  dayStamp: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function formatCashierClock(d: Date): CashierClockParts {
  return {
    clock: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
    dayStamp: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`,
  };
}
