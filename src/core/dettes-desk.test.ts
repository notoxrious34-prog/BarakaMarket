/**
 * OWNER-2026-11-12 (Dettes audit): the settlement modal must disclose the
 * Art.136 timbre collected ON TOP (the cashier collects amount + timbre),
 * and the debt figure must be bidi-safe (no "DZD 500 4" jumble).
 * Source-contract asserts — the repo has no DOM harness; the kernel timbre
 * math itself is covered by settlement tests (D-lane).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => fs.readFileSync(path.join(root, f), 'utf8');

test('DETtes-OWNER-2026-11-12: settlement modal discloses live timbre total', () => {
  const src = read('src/components/Clients/CarnetDetteView.tsx');
  assert.ok(src.includes('calculateTimbreFiscalCt'), 'modal must compute the live timbre via the fiscal kernel');
  assert.ok(src.includes('Total à encaisser') && src.includes('المجموع المحصّل'), 'modal must show the total to collect (FR + AR)');
});

test('DETtes-OWNER-2026-11-12: modal debt figure is bidi-safe', () => {
  const src = read('src/components/Clients/CarnetDetteView.tsx');
  assert.ok(/Solde restant:[\s\S]{0,150}?dir="ltr"/.test(src), 'the modal debt line must own dir="ltr" (no DZD jumble)');
});
