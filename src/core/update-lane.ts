/**
 * Baraka Market — update lane (T9, ADR-032).
 * The shop is offline-first: the updater is POLLED, never pushed. Checking is
 * free for every role (information); download+install is manager+ and always
 * explicit — a cashier never gets a surprise restart mid-shift. No network /
 * no native shell => structured "unavailable", never a throw.
 * USB fallback: any release asset installs by hand; this lane only automates.
 *
 * @module core/update-lane
 */
import { isTauriRuntime } from './fiscal-authority.js';

export const UPDATE_ENDPOINT =
  'https://github.com/notoxrious34-prog/BarakaMarket/releases/latest/download/latest.json';
export const RELEASES_URL = 'https://github.com/notoxrious34-prog/BarakaMarket/releases';

export type UpdateReason = 'native-only' | 'up-to-date' | 'found' | 'error';

/**
 * Friendly connectivity guidance for update failures (audit 2026-11-11).
 * Transport stalls surface as raw reqwest English — the cashier gets
 * guidance; the raw detail is still shown small for support.
 */
export function friendlyUpdateError(ar: boolean): string {
  return ar
    ? 'تعذّر الوصول إلى خادم التحديث — تحقق من الاتصال بالإنترنت ثم أعد المحاولة، أو ثبّت النسخة يدويًا من صفحة الإصدارات (USB)'
    : 'Serveur de mise à jour injoignable — vérifiez la connexion puis réessayez, ou installez via la page des versions (USB)';
}

export interface UpdateStatus {
  available: boolean;
  current: string;
  latest: string | null;
  notes: string | null;
  reason: UpdateReason;
  detail?: string;
}

/** Parse "v1.2.3" / "1.2.3-beta.1" → [major, minor, patch]. Non-numeric → 0. */
export function parseSemver(v: string): [number, number, number] {
  const core = v.trim().replace(/^[vV]/, '').split('-')[0].split('.');
  const n = (s: string | undefined): number => {
    const x = parseInt(s ?? '', 10);
    return Number.isFinite(x) && x >= 0 ? x : 0;
  };
  return [n(core[0]), n(core[1]), n(core[2])];
}

/** -1 when a<b, 0 when equal, +1 when a>b (pre-release suffixes ignored). */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 < b1 ? -1 : 1;
  if (a2 !== b2) return a2 < b2 ? -1 : 1;
  if (a3 !== b3) return a3 < b3 ? -1 : 1;
  return 0;
}

export function isNewer(latest: string, current: string): boolean {
  return compareSemver(latest, current) === 1;
}

/** Opaque handle from checkForUpdate — pass back to installUpdate. */
export interface PendingUpdate {
  version: string;
  body: string | null;
  install: () => Promise<void>;
}

/**
 * Poll the release feed through the native updater (signature-verified).
 * Outside the Tauri shell there is no updater — report native-only.
 */
export async function checkForUpdate(
  currentVersion: string,
): Promise<{ status: UpdateStatus; pending: PendingUpdate | null }> {
  if (!isTauriRuntime()) {
    return {
      status: { available: false, current: currentVersion, latest: null, notes: null, reason: 'native-only' },
      pending: null,
    };
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const found = await check();
    if (!found) {
      return {
        status: { available: false, current: currentVersion, latest: currentVersion, notes: null, reason: 'up-to-date' },
        pending: null,
      };
    }
    if (!isNewer(found.version, currentVersion)) {
      return {
        status: { available: false, current: currentVersion, latest: found.version, notes: null, reason: 'up-to-date' },
        pending: null,
      };
    }
    return {
      status: {
        available: true, current: currentVersion,
        latest: found.version, notes: found.body ?? null, reason: 'found',
      },
      pending: {
        version: found.version,
        body: found.body ?? null,
        install: async () => {
          await found.downloadAndInstall();
        },
      },
    };
  } catch (e) {
    return {
      status: {
        available: false, current: currentVersion, latest: null, notes: null,
        reason: 'error', detail: String((e as Error)?.message ?? e).slice(0, 160),
      },
      pending: null,
    };
  }
}

/** Restart into the freshly installed version (native shell only). */
export async function relaunchApp(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
    return true;
  } catch {
    return false;
  }
}
