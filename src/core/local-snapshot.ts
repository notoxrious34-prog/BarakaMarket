/**
 * Baraka Market — offline local snapshot (browser lane, ADR-018 Backup-Pro).
 * Captures EVERY `baraka_*` localStorage key (catalog, sales, seq counters, held
 * carts, drafts, barcodes, clean-start marker…) so a restore can never lose an
 * invoice number. The envelope carries app version + SHA-256 over canonical
 * JSON (stableStringify); import fails closed on tamper, warns on version drift.
 * Store-injectable for unit tests (node has no localStorage).
 *
 * @module core/local-snapshot
 */
import { stableStringify } from './backup-catalog.js';
import { APP_VERSION } from './version.js';

export interface LocalSnapshotEnvelope {
  app: 'baraka-market';
  snapshot_version: 1;
  app_version: string;
  exported_at: string;
  sha256: string;
  data: Record<string, unknown>;
}

export type SnapshotStore = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>;

export const collectLocalSnapshotData = (store: SnapshotStore): Record<string, unknown> => {
  const data: Record<string, unknown> = {};
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k || !k.startsWith('baraka_')) continue;
    const raw = store.getItem(k);
    try { data[k] = raw == null ? null : JSON.parse(raw); }
    catch { data[k] = raw; }
  }
  return data;
};

const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};

export const buildLocalSnapshot = async (store: SnapshotStore): Promise<string> => {
  const data = collectLocalSnapshotData(store);
  const env: LocalSnapshotEnvelope = {
    app: 'baraka-market', snapshot_version: 1, app_version: APP_VERSION,
    exported_at: new Date().toISOString(), sha256: await sha256Hex(stableStringify(data)), data,
  };
  return JSON.stringify(env);
};

export interface LocalRestoreResult { keys: string[]; warnings: string[]; }

export const restoreLocalSnapshot = async (json: string, store: SnapshotStore): Promise<LocalRestoreResult> => {
  let env: LocalSnapshotEnvelope;
  try { env = JSON.parse(json) as LocalSnapshotEnvelope; }
  catch { throw new Error('not JSON'); }
  if (!env || env.app !== 'baraka-market') throw new Error('not a baraka snapshot');
  if (env.snapshot_version !== 1) {
    throw new Error(`unsupported snapshot_version ${String((env as { snapshot_version?: unknown }).snapshot_version)}`);
  }
  if (!env.data || typeof env.data !== 'object') throw new Error('snapshot has no data');
  const warnings: string[] = [];
  if (env.app_version !== APP_VERSION) {
    warnings.push(`version drift: snapshot v${env.app_version ?? '?'} → app v${APP_VERSION}`);
  }
  const actual = await sha256Hex(stableStringify(env.data));
  if (actual.toLowerCase() !== String(env.sha256 ?? '').toLowerCase()) {
    throw new Error('checksum mismatch — file altered or corrupted');
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(env.data)) {
    if (!k.startsWith('baraka_')) continue; // never write foreign keys
    store.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    keys.push(k);
  }
  if (keys.length === 0) throw new Error('snapshot holds no baraka_ keys');
  return { keys, warnings };
};
