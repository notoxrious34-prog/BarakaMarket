/**
 * ADR-046 Tier 3 (APPROVED 2026-11-12): explicit stock refusal.
 * Pure kernel — no UI, no DB. Compares in integer milli-units so KG
 * decimals never drift. Packs drain multiplier x base units (ADR-004).
 */
export interface StockLine {
  product_id: number | null;
  name_fr: string;
  quantity: number;
  packMultiplier?: number | null;
}

export interface StockRow {
  id: number;
  stock_qty: number;
}

export interface StockShortage {
  product_id: number;
  name: string;
  available: number;
  requested: number;
}

export function checkStockAvailability(
  lines: StockLine[],
  stocks: StockRow[],
): StockShortage | null {
  const byId = new Map(stocks.map(s => [s.id, s.stock_qty]));
  for (const ln of lines) {
    if (ln.product_id === null) continue; // ad-hoc line: nothing to drain
    const stock = byId.get(ln.product_id);
    if (stock === undefined) continue; // unknown product: lane decides
    const needMilli = Math.round(ln.quantity * (ln.packMultiplier ?? 1) * 1000);
    const haveMilli = Math.round(stock * 1000);
    if (needMilli > haveMilli) {
      return {
        product_id: ln.product_id,
        name: ln.name_fr,
        available: haveMilli / 1000,
        requested: needMilli / 1000,
      };
    }
  }
  return null;
}
