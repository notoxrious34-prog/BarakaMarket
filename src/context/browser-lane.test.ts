import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// T2 (ADR-023): single-lane numbering guard. The browser lane must NEVER mint
// fiscal numbers — a regression here would fork the legal sequence.
// Reads the real AppContext source, so the gate breaks the build, not the shop.
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'AppContext.tsx'), 'utf8');

test('t2: browser never mints FACT/T numbers (only Q until T2b)', () => {
  assert.ok(!src.includes("nextBrowserSeq('FACT'"), 'browser mints FACT');
  assert.ok(!src.includes("nextBrowserSeq('T'"), 'browser mints T');
  assert.ok(!src.includes('`FACT-${'), 'template-minted FACT in browser lane');
});

test('t2: provisional rows carry DRAFT refs (obviously non-fiscal)', () => {
  assert.ok(src.includes('DRAFT-FACT-'), 'missing DRAFT-FACT provisional marker');
  assert.ok(src.includes('DRAFT-T-'), 'missing DRAFT-T provisional marker');
});

test('t2: no sales.length-based numbering anywhere in the lane', () => {
  const code = src.split('\n')
    .map(l => l.replace(/\r$/, '').replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
    .join('\n');
  assert.ok(!code.includes('sales.length'), 'sales.length-based numbering');
});
