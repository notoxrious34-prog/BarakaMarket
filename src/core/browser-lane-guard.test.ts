/**
 * Browser-lane guard: client code must never statically import node-only
 * modules. `db/sqlite.ts` pulls `node:sqlite` + `reference-catalog.ts`
 * (`node:fs/url`) and kills the vite dev boot with an empty #root
 * (rootKids 0, `node:url.fileURLToPath` externalized). Fails if any file
 * under components/context/hooks imports `db/sqlite`, or if anything
 * outside server-side code imports `reference-catalog`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const CLIENT_DIRS = ['src/components', 'src/context', 'src/hooks'].map((d) => path.join(root, d));
const clientFiles = CLIENT_DIRS.filter((d) => fs.existsSync(d)).flatMap((d) => walk(d));

test('browser lane: no client file imports db/sqlite (node:sqlite kills the boot)', () => {
  const offenders = clientFiles.filter((f) => /from\s+['"][^'"]*db\/sqlite/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(root, f)), []);
});

test('browser lane: reference-catalog (node:fs) stays server-side', () => {
  const all = walk(path.join(root, 'src'));
  const offenders = all.filter((f) => {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (rel.startsWith('src/db/') || rel.startsWith('server/') || rel === 'src/core/reference-catalog.ts') return false;
    if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) return false;
    if (rel === 'scripts/seed-db.ts') return false;
    return /from\s+['"][^'"]*reference-catalog/.test(fs.readFileSync(f, 'utf8'));
  });
  assert.deepEqual(offenders, []);
});
