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
