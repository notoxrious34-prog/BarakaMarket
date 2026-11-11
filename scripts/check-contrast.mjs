/**
 * B2 (PLAN-v1.2.0): daylight contrast check — CORRECTED methodology.
 * Earlier claims derived ratios from class names (wrong: overrides + cascade).
 * Here every pair is an explicit (fg, bg) token actually rendered in light
 * mode; the script computes WCAG 2.1 ratios and fails below 4.5:1.
 * Usage: node scripts/check-contrast.mjs
 */
function lum(hex) {
  const c = hex.replace('#', '');
  const rgb = [0, 2, 4].map(i => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function ratio(fg, bg) {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// [label, fg, bg] — bg = light-mode mapped surface (index.css html.light)
const pairs = [
  ['emerald-700 total on white', '#047857', '#ffffff'],
  ['amber-700 TVA9 on white', '#b45309', '#ffffff'],
  ['amber-800 timbre on white', '#92400e', '#ffffff'],
  ['rose-700 alert on white', '#be123c', '#ffffff'],
  ['purple-800 TVA19 on white', '#7e22ce', '#ffffff'],
  ['sky-700 info on white', '#0369a1', '#ffffff'],
  ['slate-600 body on white', '#475569', '#ffffff'],
  ['slate-600 body on slate-100', '#475569', '#f1f5f9'],
  ['slate-500 placeholder on white', '#64748b', '#ffffff'],
  ['slate-800 heading on slate-100', '#1e293b', '#f1f5f9'],
  // force-dark panels keep dark surfaces in light mode:
  ['emerald-400 on navy (force-dark)', '#34d399', '#0b0f17'],
  ['amber-400 on navy (force-dark)', '#fbbf24', '#0b0f17'],
  ['slate-400 on navy (force-dark)', '#94a3b8', '#0b0f17'],
  // MKT-012 (pre-publish audit): dark muted lifted + fills deepened.
  ['slate-500 lifted on card (dark)', '#7d8da6', '#111722'],
  ['slate-500 lifted on navy (dark)', '#7d8da6', '#0b0f17'],
  ['white on amber-700 fill', '#ffffff', '#b45309'],
  ['white on emerald-700 fill', '#ffffff', '#047857'],
  ['amber-800 figure on pastel (L3)', '#92400e', '#fffbeb'],
  ['rose-700 pill on pastel (L2)', '#be123c', '#fff1f2'],
];

let fail = 0;
for (const [label, fg, bg] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.toFixed(2)}:1  ${label}  (${fg} on ${bg})`);
}
if (fail) { console.error(`\n${fail} pair(s) below 4.5:1`); process.exit(1); }
console.log('\nall daylight pairs ≥ 4.5:1');
