/**
 * Baraka Market — backup catalog (pure, environment-free).
 * Decides file names, manifest sidecars, retention pruning and manifest
 * verification. The filesystem/DB work lives in `db/sqlite.ts` (server lane)
 * and the snapshot panel (browser lane); this module is the shared brain so
 * both lanes name, prune and verify identically — and it is unit-tested.
 *
 * @module core/backup-catalog
 */

export interface BackupManifest {
  app: 'baraka-market';
  /** Backup format of THIS sidecar (not the DB schema). */
  manifest_version: 1;
  app_version: string;
  schema_version: number;
  label: string;
  created_at: string;
  filename: string;
  sha256: string;
  size_bytes: number;
  sales_count: number;
  products_count: number;
}

export interface BackupRowLike {
  id: string;
  filename: string;
  created_at: string;
  /** Server lane only: absolute snapshot path (prune deletes it). */
  filePath?: string;
}

/** baraka-backup-YYYYMMDD-HHmmss[-label][-n].sqlite — filesystem-safe label. */
export function backupFilename(now: Date, label = '', n = 0): string {
  const p = (x: number): string => String(x).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const clean = label.replace(/[^A-Za-z0-9-_]/g, '').slice(0, 24);
  const tail = `${clean ? `-${clean}` : ''}${n > 0 ? `-${n}` : ''}`;
  return `baraka-backup-${stamp}${tail}.sqlite`;
}

/** Manifest sidecar path for a backup file. */
export function manifestPathFor(backupFilePath: string): string {
  return `${backupFilePath}.manifest.json`;
}

/** Build the sidecar manifest after the snapshot bytes are final. */
export function buildManifest(input: {
  app_version: string;
  schema_version: number;
  label: string;
  created_at: string;
  filename: string;
  sha256: string;
  size_bytes: number;
  sales_count: number;
  products_count: number;
}): BackupManifest {
  return { app: 'baraka-market', manifest_version: 1, ...input };
}

/** Structural check of a parsed manifest (no fs). */
export function checkManifestShape(m: unknown): string[] {
  const errors: string[] = [];
  const o = m as Partial<BackupManifest>;
  if (!o || typeof o !== 'object') return ['manifest is not an object'];
  if (o.app !== 'baraka-market') errors.push('bad app tag');
  if (o.manifest_version !== 1) errors.push('unsupported manifest_version');
  if (!o.filename || typeof o.filename !== 'string') errors.push('bad filename');
  if (!/^[0-9a-f]{64}$/i.test(o.sha256 ?? '')) errors.push('bad sha256');
  if (!(o.size_bytes! > 0)) errors.push('bad size_bytes');
  if (!Number.isInteger(o.schema_version) || o.schema_version! < 1) errors.push('bad schema_version');
  if (typeof o.created_at !== 'string' || Number.isNaN(Date.parse(o.created_at))) errors.push('bad created_at');
  return errors;
}

/**
 * Retention: newest-first rows → which ids to delete to keep `keep` newest.
 * Pure (no fs) so the policy is tested once and reused by every lane.
 */
export function prunePlan<T extends BackupRowLike>(newestFirst: T[], keep: number): T[] {
  if (keep < 1) throw new Error('[backup] retention keep must be >= 1');
  return newestFirst.slice(keep);
}

/** Human age for the UI header («il y a 3 j» / «il y a 2 h»). */
export function backupAgeLabel(createdAt: string, nowMs = Date.now(), isAr = false): string {
  const ms = Math.max(0, nowMs - Date.parse(createdAt));
  const min = Math.floor(ms / 60000);
  if (min < 1) return isAr ? 'الآن' : "à l'instant";
  if (min < 60) return isAr ? `منذ ${min} د` : `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return isAr ? `منذ ${h} س` : `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return isAr ? `منذ ${d} يوم` : `il y a ${d} j`;
}
