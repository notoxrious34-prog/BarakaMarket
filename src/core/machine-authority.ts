/**
 * Baraka Market — machine identity bridge (ADR-050 P1).
 * Invoke-first, loopback fallback, local last — the same lane order as the
 * fiscal commit path. The seed is META-ANCHORED: SQLite `meta.machine_seed`
 * wins over the browser localStorage copy, so wiping site data no longer
 * rotates the HWID (and no longer falsely drift-locks a paying shop).
 *
 * @module core/machine-authority
 */
import { isTauriRuntime, LOOPBACK_BASE, getLoopbackToken } from './fiscal-authority.js';
import type { MachineParts } from './licensing';
import { getOrCreateMachineSeed } from './license-store';

export interface NativeMachineFacts {
  guid: string;
  hostname: string;
  arch: string;
  os: string;
}

export const MACHINE_SEED_META_KEY = 'machine_seed';
import { LICENSE_GATE_META_KEY, LICENSE_OVERRIDE_META_KEY, TRIAL_EPOCH_META_KEY } from './license-gate.js';
export { LICENSE_GATE_META_KEY, LICENSE_OVERRIDE_META_KEY, TRIAL_EPOCH_META_KEY };
export const UNLOCK_COUNTER_META_KEY = 'unlock_counter';

/** Lane-agnostic meta read (invoke-first, loopback fallback, null last). */
export async function readMetaKv(key: string): Promise<string | null> {
  return metaGet(key);
}

/** Lane-agnostic meta write (fire-and-forget; absence never blocks). */
export function writeMetaKv(key: string, value: string): void {
  metaSet(key, value);
}

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    return ((await mod.invoke(command, args)) as T) ?? null;
  } catch {
    return null;
  }
}

/** Native facts on the exe lane, null everywhere else (browser = best-effort). */
export async function collectMachineFacts(): Promise<NativeMachineFacts | null> {
  const f = await invokeNative<NativeMachineFacts>('machine_hwid');
  if (f && typeof f.hostname === 'string') return f;
  return null;
}

/**
 * HWID parts from native facts. The formula is IDENTICAL to the browser one
 * (`arch|hostname|osVersion|seed`) — only the sources are stable: MachineGuid
 * (else COMPUTERNAME) instead of UA strings.
 */
export function nativeParts(facts: NativeMachineFacts, seed: string): MachineParts {
  return {
    arch: facts.arch || 'unknown',
    hostname: (facts.guid || facts.hostname || 'unknown').trim().toUpperCase(),
    osVersion: facts.os || 'native',
    seed,
  };
}

async function metaGet(key: string): Promise<string | null> {
  const n = await invokeNative<string | null>('meta_get', { key });
  if (typeof n === 'string') return n;
  if (isTauriRuntime()) return null;
  try {
    const r = await fetch(`${LOOPBACK_BASE}/api/meta/${encodeURIComponent(key)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { value?: string };
    return typeof j.value === 'string' ? j.value : null;
  } catch {
    return null;
  }
}

function metaSet(key: string, value: string): void {
  (async () => {
    try {
      const n = await invokeNative<unknown>('meta_set', { key, value });
      if (n !== null || isTauriRuntime()) return;
      const token = await getLoopbackToken();
      await fetch(`${LOOPBACK_BASE}/api/meta/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-baraka-loopback': token } : {}) },
        body: JSON.stringify({ value }),
        signal: AbortSignal.timeout(2000),
      }).catch(() => { /* browser lane without token: local copy stays */ });
    } catch { /* meta is an anchor, never a blocker */ }
  })();
}

/**
 * ADR-050 P2: publish the boot verdict for the native lane (it carries no
 * crypto). Fire-and-forget; the lane treats absence as "no verdict".
 */
export function publishLicenseGate(ok: boolean, reason?: string): void {
  metaSet(LICENSE_GATE_META_KEY, JSON.stringify({ ok, ...(reason ? { reason } : {}), at: Date.now() }));
}

/**
 * The machine seed, meta-anchored. Order: SQLite meta → browser localStorage
 * (created on demand) → mirror the winner into the other store so both lanes
 * converge on one seed and the HWID never rotates behind our back.
 */
export async function ensureMachineSeed(): Promise<string> {
  try {
    const anchored = await metaGet(MACHINE_SEED_META_KEY);
    if (anchored && anchored.trim()) {
      try {
        if (typeof localStorage !== 'undefined' && !localStorage.getItem('baraka_machine_seed')) {
          localStorage.setItem('baraka_machine_seed', anchored);
        }
      } catch { /* private mode */ }
      return anchored;
    }
  } catch { /* fall through to local */ }
  const local = getOrCreateMachineSeed();
  if (local && local !== 'headless-seed') metaSet(MACHINE_SEED_META_KEY, local);
  return local;
}
