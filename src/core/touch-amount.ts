/**
 * C1 (PLAN-v1.2.0): touch keypad for the cash-tender field.
 * Pure `current + key -> next` so the POS modal stays a thin view and the
 * rule is guard-tested. Same engine downstream: the field still flows into
 * `cash-tender.ts` — no new money logic here.
 */
export type TouchKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'C' | 'back';

const MAX_LEN = 9;

export function touchAmountKey(current: string, key: TouchKey): string {
  if (key === 'C') return '';
  if (key === 'back') return current.slice(0, -1);
  if (current.length >= MAX_LEN) return current;
  if (key === '.') {
    if (current.includes('.')) return current;
    return current === '' ? '0.' : current + '.';
  }
  if (key === '00') {
    if (current === '') return '0';
    if (current.length + 2 > MAX_LEN) return current;
    return current + '00';
  }
  // plain digit — avoid leading-zero pile-up ("0005" -> "5")
  if (current === '0') return key;
  return current + key;
}
