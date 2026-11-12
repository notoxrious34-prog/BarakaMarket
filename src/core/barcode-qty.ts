/**
 * B3 (PLAN-v1.2.0): `N*CODE` quantity prefix for the scanner field.
 * Pure parser — `12*613000000021` adds 12 units in one scan+Enter instead
 * of 12 scans. OWNER-2026-11-12: decimal multipliers with Algerian comma
 * or dot (`0,5*9305` = half a kilo) — milli precision, never floats downstream.
 * Scale labels (20/21/22/28/29) never carry a prefix: the label itself is
 * the quantity, so a prefix there is ignored downstream.
 */
export interface QtyPrefix { mult: number; core: string; hadPrefix: boolean }

const QTY_RE = /^(\d{1,4}(?:[.,]\d{1,3})?)\s*\*\s*(.+)$/;

export function parseQtyPrefix(raw: string): QtyPrefix {
  const code = raw.trim();
  const m = code.match(QTY_RE);
  if (!m || m[2].trim() === '') return { mult: 1, core: code, hadPrefix: false };
  const n = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return { mult: 1, core: m[2].trim(), hadPrefix: true };
  const mult = Math.min(999, Math.round(n * 1000) / 1000);
  return { mult, core: m[2].trim(), hadPrefix: true };
}
