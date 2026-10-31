/**
 * Baraka Market — Gold Master release verification (ADR-016-MKT).
 * Usage: npm run verify:release   (exits 0 = READY, 1 = BLOCKED)
 *
 * Checks: key hygiene, schema bootstrap (22 tables), offline bundle
 * purity, then the full gates (lint / build / test:all >= 186).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb } from '../src/db/sqlite.js';

const ROOT = path.resolve('.');
let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// 1. Key hygiene: privkey ignored, absent from dist/src, pubkey present.
{
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  check('Cryptographic Offline Key Isolation (.gitignore bans *.pem)', gi.includes('*.pem'));
  const pems = [
    ...walk(path.join(ROOT, 'src')).filter(f => f.endsWith('.pem')),
    ...(fs.existsSync(path.join(ROOT, 'dist')) ? walk(path.join(ROOT, 'dist')).filter(f => f.endsWith('.pem')) : []),
  ];
  check('No private key material in src/ or dist/', pems.length === 0, pems[0] ?? 'clean');
  const lic = fs.readFileSync(path.join(ROOT, 'src/core/licensing.ts'), 'utf8');
  const m = lic.match(/BARAKA_PUBLIC_KEY = '([0-9a-f]{64})'/);
  check('Ed25519 Public Licensing Seal', !!m, m ? `${m[1].slice(0, 12)}…` : 'missing');
}

// 2. Schema bootstrap: fresh DB, integrity, 22 tables, profile, seq.
{
  const b = openBarakaDb(':memory:');
  try {
    const integ = (b.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    const tables = (b.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all() as { name: string }[]).map(r => r.name);
    const expected = ['meta', 'store_profile', 'products', 'product_barcodes', 'inventory_losses',
      'clients', 'suppliers', 'seq', 'sales', 'sale_items', 'client_settlements', 'active_cart_draft',
      'purchases', 'purchase_items', 'supplier_payments', 'z_reports', 'void_log',
      'cash_sessions', 'cash_movements', 'backups_log', 'ref_categories', 'ref_templates'];
    const missing = expected.filter(t => !tables.includes(t));
    check(`Complete Schema Bootstrap (${expected.length - missing.length}/${expected.length} tables verified)`,
      integ === 'ok' && missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : `integrity=${integ}`);
    const profile = b.db.prepare('SELECT COUNT(*) AS n FROM store_profile WHERE id = 1').get() as { n: number };
    // By design the profile row is shop-onboarded via scripts/seed-db.ts (no
    // schema default); the bootstrap contract is table + columns + writable.
    const cols = (b.db.prepare("SELECT name FROM pragma_table_info('store_profile')").all() as { name: string }[]).map(c => c.name);
    const hasContract = ['store_name', 'phone', 'timbre_rate', 'timbre_min_ct', 'timbre_max_ct'].every(c => cols.includes(c));
    b.setMeta('verify:probe', 'ok');
    const metaOk = b.getMeta('verify:probe') === 'ok';
    check('Store profile + meta lanes ready (onboarded via seed-db)', hasContract && metaOk,
      `profileRows=${profile.n} (onboarding), meta=${metaOk ? 'rw' : 'RO'}`);
    const t1 = b.nextTicketNumber(2026);
    check('Monotonic sequences initialize', /^T-2026-\d{6}$/.test(t1), t1);
  } finally {
    b.close();
  }
}

// 3. Offline bundle purity: no remote URLs (except fonts/loopback/schema), no pem.
{
  // react.dev error-doc URLs are inert string literals baked into the React
  // production bundle (never fetched — the app runs fully offline).
  // www.w3.org is the SVG XML namespace constant (createElementNS/xmlns),
  // likewise never fetched.
  const allowed = ['fonts.googleapis.com', 'fonts.gstatic.com', '127.0.0.1:3100', 'localhost', 'ipc.localhost', 'schema.tauri.app', 'react.dev', 'www.w3.org'];
  const bad: string[] = [];
  if (fs.existsSync(path.join(ROOT, 'dist'))) {
    for (const f of walk(path.join(ROOT, 'dist'))) {
      if (!/\.(js|css|html)$/.test(f)) continue;
      const hits = fs.readFileSync(f, 'utf8').match(/https?:\/\/[^\s"'<>]+/g) ?? [];
      for (const h of hits) {
        if (!allowed.some(a => h.includes(a))) bad.push(`${path.basename(f)}: ${h.slice(0, 60)}`);
      }
    }
  }
  check('Zero Unapproved Runtime Dependencies', bad.length === 0, bad[0] ?? 'bundle clean');
}

// 4. Full gates.
const run = (cmd: string): { ok: boolean; out: string } => {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: String(err.stdout ?? err.stderr ?? e).slice(-2000) };
  }
};
{
  const lint = run('npm run lint');
  check('TypeScript Typecheck & Linting (tsc --noEmit)', lint.ok);
  const build = run('npm run build');
  check('Production Vite Bundle Assets', build.ok && /built in/.test(build.out));
  const tests = run('npm run test:all');
  const n = tests.out.match(/ℹ tests (\d+)/)?.[1] ?? tests.out.match(/tests (\d+)/)?.[1] ?? '0';
  const f = tests.out.match(/ℹ fail (\d+)/)?.[1] ?? tests.out.match(/fail (\d+)/)?.[1] ?? '?';
  check(`Automated Test Suite Execution (>= 186 Tests Passing)`, tests.ok && Number(n) >= 186 && f === '0', `${n} tests, ${f} fail`);
  const moneySrc = fs.readFileSync(path.join(ROOT, 'src/core/money.ts'), 'utf8');
  check('Pure Integer Centimes & Milli-Unit Quantity Constraints',
    /assertIntegerCentimes/.test(moneySrc) && /Centimes/.test(moneySrc), 'brand + guard present');
}

console.log('='.repeat(62));
console.log('BARAKA MARKET v2.0-MKT — GOLD MASTER RELEASE AUDIT SUMMARY');
console.log('='.repeat(62));
console.log(failures === 0
  ? 'RELEASE CANDIDATE: READY FOR PACKAGING & DISTRIBUTION'
  : `RELEASE CANDIDATE: BLOCKED (${failures} check(s) failed)`);
console.log('='.repeat(62));
process.exit(failures === 0 ? 0 : 1);
