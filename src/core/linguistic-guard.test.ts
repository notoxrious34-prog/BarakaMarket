/**
 * B1 (PLAN-v1.2.0): linguistic-unification guard. The fixed slips must never
 * return: dialect slips, بيعة/عملية mixing, Latin inside Arabic labels, raw
 * category ids on screen. Runs on source text — zero occurrences or red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|html)$/.test(e.name)) {
      if (e.name === 'linguistic-guard.test.ts') continue; // the guard names its own quarries
      out.push(p);
    }
  }
  return out;
}

test('B1: no dialect/mixing slips in UI strings', () => {
  const bad: string[] = [];
  for (const f of walk(path.join(root, 'src'))) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    if (src.includes('بالسوبرماركت')) bad.push(`${rel}: بالسوبرماركت`);
    if (/بيعة/.test(src)) bad.push(`${rel}: بيعة (use عملية بيع)`);
    if (/\(Code Balance/.test(src)) bad.push(`${rel}: Latin (Code Balance inside Arabic label`);
  }
  assert.deepEqual(bad, [], `linguistic slips found:\n${bad.join('\n')}`);
});

test('B1: stock table shows category names, never raw ids', () => {
  const src = read('src/components/Inventory/ProductsStockView.tsx');
  assert.ok(!src.includes('{p.category_id}'), 'raw {p.category_id} rendered on screen');
  assert.ok(src.includes('initialCategories.find'), 'expected a category-name lookup');
});
