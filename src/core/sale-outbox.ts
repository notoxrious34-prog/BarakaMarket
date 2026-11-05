/**
 * T1 slice B (ADR-022): offline sale outbox + idempotent auto-replay.
 * Pure module — StorageLike-injected, no React, no DOM, fully unit-tested.
 *
 * Contract: every fiscal payload that fails to POST is persisted here with
 * the SAME client_sale_id. Replay re-POSTs unchanged; the server's slice-A
 * idempotency turns retries into the original row (never a second seq).
 * The provisional browser row is then UPGRADED (not duplicated).
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OutboxEntry {
  /** Idempotency key minted once at finalize — stable across retries. */
  key: string;
  /** Fiscal lane this payload belongs to (T2b generalizes the T1 outbox). */
  kind: 'sale' | 'settlement';
  /** Browser provisional id to upgrade on success. */
  provisionalId: string;
  header: unknown;
  items: unknown[];
  enqueuedAt: string;
  attempts: number;
  /** Last fiscal refusal reason (native/loopback), shown under the stuck row. */
  lastError?: string;
}

export interface OutboxReceipt {
  key: string;
  kind: 'sale' | 'settlement';
  provisionalId: string;
  auth: { id: string; invoice_number?: string; ticket_number?: string; receipt_number?: string };
}

export const OUTBOX_KEY = 'baraka_sale_outbox_v1';
/** Rush-hour bound: a full day of degraded sales fits; oldest drops first. */
export const OUTBOX_CAP = 200;

export function mintSaleKey(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch { /* non-secure context fallback below */ }
  return `key-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

export function loadOutbox(store: StorageLike): OutboxEntry[] {
  try {
    const raw = store.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is OutboxEntry =>
      !!e && typeof (e as OutboxEntry).key === 'string' && Array.isArray((e as OutboxEntry).items))
      // Backward compat: pre-kind entries (T1) are sale payloads.
      .map(e => ({ ...e, kind: (e.kind ?? 'sale') as 'sale' | 'settlement' }));
  } catch {
    return [];
  }
}

function saveOutbox(store: StorageLike, entries: OutboxEntry[]): void {
  store.setItem(OUTBOX_KEY, JSON.stringify(entries));
}

export function enqueueOutbox(store: StorageLike, entry: OutboxEntry): OutboxEntry[] {
  const q = loadOutbox(store).filter(e => e.key !== entry.key);
  q.push(entry);
  while (q.length > OUTBOX_CAP) q.shift();
  saveOutbox(store, q);
  return q;
}

/** A1: owner-reviewed discard for poison entries that can never drain.
 * Removal is explicit + audited at the call site — never silent. */
export function removeOutboxEntry(store: StorageLike, key: string): OutboxEntry[] {
  const q = loadOutbox(store).filter(e => e.key !== key);
  saveOutbox(store, q);
  return q;
}

/** A1 (PLAN-v1.2.0): visible pending count — the UI badge reads this. */
export function pendingOutboxCount(store: StorageLike): number {
  return loadOutbox(store).length;
}

/**
 * Replay every queued payload through `post`. One poison entry never blocks
 * the rest; failures stay queued with attempts+1 for the next drain.
 * `post` receives the whole entry and routes by `kind`.
 */
export async function replayOutbox(
  store: StorageLike,
  post: (entry: OutboxEntry) => Promise<OutboxReceipt['auth'] | null>,
): Promise<{ done: OutboxReceipt[]; remaining: OutboxEntry[] }> {
  const q = loadOutbox(store);
  const done: OutboxReceipt[] = [];
  const remaining: OutboxEntry[] = [];
  for (const e of q) {
    let auth = null;
    let reason: string | undefined;
    try {
      auth = await post(e);
      if (!auth) reason = 'fiscal lane refused without reason';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reason = msg.slice(0, 240);
      auth = null;
    }
    if (auth) {
      done.push({ key: e.key, kind: e.kind, provisionalId: e.provisionalId, auth });
    } else {
      remaining.push({ ...e, attempts: e.attempts + 1, lastError: reason ?? e.lastError });
    }
  }
  saveOutbox(store, remaining);
  return { done, remaining };
}
