/**
 * TASK-MKT-002: the page must never scroll — the root shell locks the viewport
 * (h-dvh + overflow-hidden) and every view owns its inner scroll region.
 * Regression guard: ban min-h-screen on the shell and raw 100vh in views.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => fs.readFileSync(path.join(root, f), 'utf8');

test('MKT-002: App shell locks the viewport (h-dvh, no min-h-screen)', () => {
  const src = read('src/App.tsx');
  assert.ok(src.includes('h-dvh overflow-hidden'), 'App root must carry the h-dvh overflow-hidden lock');
  assert.ok(!src.includes('min-h-screen'), 'App shell must not use min-h-screen (page would grow past the viewport)');
  assert.ok(src.includes('<main className="flex-1 flex flex-col overflow-hidden min-h-0">'), 'main must keep the min-h-0 scroll-containment chain');
});

test('MKT-002: views size against the dynamic viewport (100dvh, never 100vh)', () => {
  for (const f of [
    'src/components/POS/PosView.tsx',
    'src/components/Inventory/ProductsStockView.tsx',
    'src/components/Clients/CarnetDetteView.tsx',
    'src/components/Suppliers/SuppliersPurchasesView.tsx',
    'src/components/Reports/DailyZReportView.tsx',
    'src/components/Session/LoginScreen.tsx',
  ]) {
    const src = read(f);
    assert.ok(!src.includes('100vh'), `${f} still sizes against 100vh (mobile browser chrome would clip)`);
  }
  const pos = read('src/components/POS/PosView.tsx');
  assert.ok(pos.includes('100dvh'), 'PosView must size against 100dvh');
});

test('MKT-011: scroll-dead desks own their scroll region (audit 2026-11-11)', () => {
  // The h-dvh root lock + main[overflow-hidden] mean a view WITHOUT its own
  // overflow-y-auto clips any overflowing content with NO user scroll avenue
  // (document never scrolls; main is not user-scrollable). Ventes proved it:
  // the Duplicata CTA sat 112px below the fold at 1024×650, unreachable.
  const sales = read('src/components/Sales/SalesBookView.tsx');
  assert.ok(
    sales.includes('min-h-0 overflow-y-auto space-y-4'),
    'SalesBookView ROOT must own the scroll region (flex-1 min-h-0 overflow-y-auto space-y-4, like Accounting/Cash) — inner boxes alone left the Duplicata CTA clipped dead',
  );
});
