/**
 * A3 (PLAN-v1.2.0): the version lie can never return. APP_VERSION must equal
 * package.json, and the three former hardcode sites must carry no literal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from './version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

test('A3: APP_VERSION tracks package.json and is semver', () => {
  assert.equal(APP_VERSION, pkg.version);
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test('A3: no hardcoded vX.Y literals at the former lie sites', () => {
  for (const f of ['src/App.tsx', 'src/components/Receipts/TicketThermal80mm.tsx', 'src/components/Settings/UpdateManagerView.tsx']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/v1\.\d/.test(src), `${f} still carries a hardcoded v1.x literal`);
  }
});
