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
}

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
}
