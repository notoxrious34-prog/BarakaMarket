/**
 * Baraka Market — license persistence (browser lane).
 * localStorage-backed; guarded for SSR/test (node) runtimes.
 *
 * @module core/license-store
 */
import type { LicenseStatus } from './licensing';

export interface StoredLicense {
  status: LicenseStatus;
  storeName: string;
  key: string;
  installedAtMs: number;
  /** HWID the key was issued for — restore is refused on mismatch. */
  hwid?: string;
}

/** SQLite meta mirror key (server lane `/api/meta/:key`, 512-char cap respected). */
export const LICENSE_META_KEY = 'license_state';

const LICENSE_KEY = 'baraka_license_v1';
const SEED_KEY = 'baraka_machine_seed';
const INSTALL_KEY = 'baraka_installed_at';

function ls(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getOrCreateMachineSeed(): string {
  const s = ls();
  if (!s) return 'headless-seed';
  let seed = s.getItem(SEED_KEY);
  if (!seed) {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    seed = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    try { s.setItem(SEED_KEY, seed); } catch { /* private mode */ }
  }
  return seed;
}

export function getInstallEpochMs(): number {
  const s = ls();
  const now = Date.now();
  if (!s) return now;
  const raw = s.getItem(INSTALL_KEY);
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  try { s.setItem(INSTALL_KEY, String(now)); } catch { /* ignore */ }
  return now;
}

export function loadStoredLicense(): StoredLicense | null {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(LICENSE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredLicense;
    if (p.status !== 'ACTIVATED' && p.status !== 'TRIAL') return null;
    return p;
  } catch {
    return null;
  }
}

export function saveStoredLicense(l: StoredLicense): void {
  ls()?.setItem(LICENSE_KEY, JSON.stringify(l));
  // Fire-and-forget SQLite mirror — loopback may be absent (browser-only lane).
  try {
    const payload = JSON.stringify(l);
    if (payload.length > 512) return; // server meta cap: skip mirror, local copy stays
    void fetch('http://127.0.0.1:3100/api/meta/license_state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: payload }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* offline lane: localStorage remains authoritative */ });
  } catch { /* fetch unavailable */ }
}

/**
 * Restore an ACTIVATED license from the SQLite meta mirror after browser
 * data loss. Refuses records whose HWID does not match this machine.
 */
export async function restoreLicenseFromSqlite(currentHwid: string): Promise<StoredLicense | null> {
  try {
    const res = await fetch('http://127.0.0.1:3100/api/meta/license_state', {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const { value } = (await res.json()) as { value?: string };
    if (!value) return null;
    const rec = JSON.parse(value) as StoredLicense;
    if (rec.status !== 'ACTIVATED' || !rec.key || !rec.storeName) return null;
    if (rec.hwid && rec.hwid !== currentHwid) return null;
    return rec;
  } catch {
    return null;
  }
}
