/**
 * B3 (PLAN-v1.2.0): `N*CODE` quantity prefix for the scanner field.
 * Pure parser — `12*613000000021` adds 12 units in one scan+Enter instead
 * of 12 scans. Scale labels (20/21/22/28/29) never carry a prefix: the
 * label itself is the quantity, so a prefix there is ignored downstream.
 */
export interface QtyPrefix { mult: number; core: string }

const QTY_RE = /^(\d{1,4})\*(.+)$/;

export function parseQtyPrefix(raw: string): QtyPrefix {
  const code = raw.trim();
  const m = code.match(QTY_RE);
  if (!m) return { mult: 1, core: code };
  const mult = Math.max(1, Math.min(999, parseInt(m[1], 10)));
  return { mult, core: m[2].trim() };
}
