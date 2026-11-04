/**
 * Baraka Market — release-gate: the manifest URL must name a REAL asset.
 * Root-caused 2026-11-04: `latest.json` pointed at `Baraka%20Market_…` (space)
 * while GitHub stored `Baraka.Market_…` (dot) → every client install 404'd.
 * Usage: node scripts/verify-release.mjs v1.4.4
 * Exit 0 = URL basename is a published asset AND signature length is sane.
 * Anything else prints the mismatch and exits 2 (never ship on assumption).
 */
const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('usage: node scripts/verify-release.mjs vX.Y.Z');
  process.exit(2);
}
const OWNER_REPO = 'notoxrious34-prog/BarakaMarket';
const api = async (path) => {
  const r = await fetch(`https://api.github.com/repos/${OWNER_REPO}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'baraka-release-gate' },
  });
  if (!r.ok) throw new Error(`GitHub API ${r.status} on ${path}`);
  return r.json();
};
const fail = (msg) => { console.error(`RELEASE-GATE REFUSED: ${msg}`); process.exit(2); };
try {
  const rel = await api(`/releases/tags/${tag}`);
  const assets = (rel.assets || []).map((a) => a.name);
  const manifestAsset = (rel.assets || []).find((a) => a.name === 'latest.json');
  if (!manifestAsset) fail(`${tag} publishes no latest.json`);
  const mj = await (await fetch(manifestAsset.browser_download_url)).json();
  if (mj.version !== tag.slice(1)) fail(`manifest version ${mj.version} != ${tag}`);
  if ('name' in mj) fail('manifest carries forbidden top-level `name` (breaks updater serde)');
  for (const [platform, p] of Object.entries(mj.platforms || {})) {
    const url = p.url || '';
    const base = decodeURIComponent(url.split('/').pop() || '');
    if (!base) fail(`${platform}: empty url`);
    if (!assets.includes(base)) {
      fail(`${platform}: url names ${JSON.stringify(base)} but published assets are ${JSON.stringify(assets)}`);
    }
    if (/\s/.test(base)) fail(`${platform}: asset name ${JSON.stringify(base)} contains whitespace (upload mangles it)`);
    if (String(p.signature || '').length < 100) fail(`${platform}: signature suspiciously short`);
    // The URL itself must resolve (follows GitHub's 302 to the object store).
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (!head.ok) fail(`${platform}: HEAD ${url} -> ${head.status}`);
    console.log(`gate OK [${platform}]: asset ${base} published, signature ${String(p.signature).length} chars, url resolves ${head.status}`);
  }
  console.log(`RELEASE-GATE PASS: ${tag} manifest matches published assets.`);
} catch (e) {
  fail(String((e && e.message) || e));
}
