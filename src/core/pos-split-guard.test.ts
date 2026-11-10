/**
 * TASK-MKT-004: PosView stays an orchestrator — heavy presentational
 * blocks live in memoized islands. Fails if anyone inlines them back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => fs.readFileSync(path.join(root, f), 'utf8');

test('MKT-004: PosView delegates to memoized islands', () => {
  const src = read('src/components/POS/PosView.tsx');
  for (const island of ['PosShortcutsBar', 'PosFiscalTotals', 'PosCartLine', 'PosProductCard']) {
    assert.ok(src.includes(`<${island}`), `PosView must render <${island}>`);
    assert.ok(fs.existsSync(path.join(root, `src/components/POS/${island}.tsx`)), `${island}.tsx must exist`);
  }
  assert.ok(!src.includes('tva_breakdown[9]'), 'fiscal totals must not be inlined in PosView');
  assert.ok(!src.includes('isPerishableSoon'), 'product card must not be inlined in PosView');
  const lines = src.split('\n').length;
  assert.ok(lines < 600, `PosView must stay split (now ${lines} lines, was 746)`);
});
