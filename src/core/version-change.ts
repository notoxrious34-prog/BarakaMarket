/** Boot version-shift detector: closes the silent-update audit gap.
 * The Tauri updater can replace the binary without the app's update flow
 * running (auto-install at launch) — then no `update.install` row exists.
 * On every boot the app compares the last-seen version (localStorage) with
 * the running build and audits any shift. Pure + unit-tested. */

export type VersionShift = 'fresh' | 'same' | 'upgraded' | 'downgraded';

function parts(v: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function detectVersionShift(
  lastSeen: string | null | undefined,
  current: string,
  knownInstall = false,
): VersionShift {
  // One-time catch-up: the key was introduced in v1.4.2, so an upgrade from
  // an older build arrives with NO key but a clear install footprint
  // (license/session/products…). That must audit as an upgrade with unknown
  // origin — otherwise the very gap this closes would swallow its own proof.
  if (!lastSeen) return knownInstall ? 'upgraded' : 'fresh';
  if (lastSeen === current) return 'same';
  const a = parts(lastSeen);
  const b = parts(current);
  if (!a || !b) return 'upgraded'; // unparseable change still gets audited
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return 'upgraded';
    if (b[i] < a[i]) return 'downgraded';
  }
  return 'same';
}
