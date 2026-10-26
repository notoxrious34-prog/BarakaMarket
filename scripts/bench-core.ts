/**
 * Bench: POS-critical paths. Budget: interactive line <150ms (target: <5ms engine).
 * Usage: npx tsx scripts/bench-core.ts
 */
import { calculateLineTotalsCt, calculateSaleTotalsCt } from '../src/core/fiscal.centimes.js';
import { openBarakaDb } from '../src/db/sqlite.js';

const time = (fn: () => void, iters: number) => {
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return (performance.now() - t0) / iters;
};

const lineMs = time(() => calculateLineTotalsCt(18000, 2, 9), 10_000);
const items = [
  { tva_rate: 9 as const, ...calculateLineTotalsCt(18000, 2, 9) },
  { tva_rate: 0 as const, ...calculateLineTotalsCt(65000, 1, 0) },
  { tva_rate: 19 as const, ...calculateLineTotalsCt(12000, 3, 19) },
  { tva_rate: 9 as const, ...calculateLineTotalsCt(28000, 1.45, 9) },
];
const saleMs = time(() => calculateSaleTotalsCt(items, 'ESPECES'), 10_000);

const b = openBarakaDb(':memory:');
const t0 = performance.now();
for (let i = 0; i < 1000; i++) b.nextInvoiceNumber(2026);
const seqMs = (performance.now() - t0) / 1000;
b.close();

const report = {
  line_avg_ms: +lineMs.toFixed(4),
  sale4lines_avg_ms: +saleMs.toFixed(4),
  seq_next_avg_ms: +seqMs.toFixed(4),
  budget_interactive_ms: 150,
  verdict: lineMs < 150 && saleMs < 150 && seqMs < 150 ? 'PASS' : 'FAIL',
};
console.log(JSON.stringify(report, null, 2));
if (report.verdict !== 'PASS') process.exit(1);
