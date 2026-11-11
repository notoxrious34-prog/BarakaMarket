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

test('MKT-012: pre-publish audit fixes — light islands dead, dark AA, UHD density', () => {
  // Owner-approved اعتماد list (2026-11-11): L1–L4 light islands, dark
  // slate-500/button fills below AA, UHD-4K density. All fixes live in the
  // html.light remap layer + dark AA nudges (index.css) and 2560px+
  // breakpoints in the desks — never in lane logic.
  const css = read('src/index.css');
  // L1 (POS expense btn) + L4 (Clôture buttons): bg-[#1e293b] stayed dark
  // navy while its text mapped dark → unreadable. Must map to light.
  assert.ok(css.includes('html.light .bg-\\[\\#1e293b\\]'), 'L1+L4: html.light must remap bg-[#1e293b] to a light surface');
  // L2 (expired pills): plain bg-rose-950 never mapped to pastel (only /60 /40 were).
  assert.ok(css.includes('html.light .bg-rose-950'), 'L2: html.light must remap plain bg-rose-950 to pastel');
  // Same family: plain bg-sky-950 (1 usage, text-sky-400).
  assert.ok(css.includes('html.light .bg-sky-950'), 'L2b: html.light must remap plain bg-sky-950 to pastel');
  // L3 (suppliers 81 000 figure): text-amber-200 never mapped daylight.
  assert.ok(css.includes('html.light .text-amber-200'), 'L3: html.light must remap text-amber-200 to amber-800');
  // Dark AA: slate-500 muted text fails on navy/card (3.77–4.03) → #7d8da6 (≥5.3).
  assert.ok(css.includes('#7d8da6'), 'AA-dark: muted text must be lifted to #7d8da6');
  // Dark+light AA: white on amber-600/emerald-600 fails small text (3.19/3.77)
  // → fills deepen to amber-700/emerald-700 (≥5.0), white text kept (identity).
  assert.ok(css.includes('#b45309'), 'AA-fills: amber fills must deepen to amber-700 #b45309');
  // UHD-4K density: deterministic markers + plain CSS media (Tailwind v4.3.3
  // empirically drops min-[2560px]:* here — live probe 2026-11-11).
  const pos = read('src/components/POS/PosView.tsx');
  assert.ok(pos.includes('pos-product-grid'), 'UHD: PosView grid must carry the pos-product-grid marker');
  const ret = read('src/components/Returns/ReturnsView.tsx');
  assert.ok(ret.includes('desk-wide'), 'UHD: ReturnsView must carry the desk-wide marker');
  assert.ok(css.includes('.pos-product-grid { grid-template-columns: repeat(8'), 'UHD: 2560px media must set 8 POS columns');
  assert.ok(css.includes('.desk-wide { max-width: 1760px; }'), 'UHD: 2560px media must widen the desk');
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
  // ADR-045 (approved): the Returns desk joins the same contract — 19 drafts
  // clipped 3198px with zero scroll avenue (Retours audit 2026-11-11).
  const ret = read('src/components/Returns/ReturnsView.tsx');
  assert.ok(
    ret.includes('min-h-0 overflow-y-auto'),
    'ReturnsView ROOT must own the scroll region (flex-1 min-h-0 overflow-y-auto) — the stacked desk clipped whole panels dead',
  );
});
