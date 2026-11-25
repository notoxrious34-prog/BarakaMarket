/**
 * ADR-051 P1 — Rapide memory: per-label price/tva/unit/vendor + recents + pins.
 * Pure + injectable store (localStorage in the app, Map in tests).
 * Key: `baraka_rapide_v1`. Cap 100 entries (least-recent non-pinned pruned).
 */
import type { RapideTva, RapideUnit } from './rapide';

export const RAPIDE_MEM_KEY = 'baraka_rapide_v1';
const MEM_CAP = 100;

export interface RapideMemEntry {
  label: string;
  priceTtcCt: number;
  tva: RapideTva;
  unit: RapideUnit;
  vendor: string;
  uses: number;
  lastUsedMs: number;
  pinned: boolean;
}

export type MemStore = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
};

export function loadRapideMemory(store: MemStore): Record<string, RapideMemEntry> {
  try {
    const raw = store.getItem(RAPIDE_MEM_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p || typeof p !== 'object') return {};
    const out: Record<string, RapideMemEntry> = {};
    for (const [k, v] of Object.entries(p)) {
      const e = v as Partial<RapideMemEntry>;
      if (typeof k !== 'string' || !Number.isInteger(e.priceTtcCt ?? NaN) || (e.priceTtcCt ?? 0) <= 0) continue;
      if (e.tva !== 0 && e.tva !== 9 && e.tva !== 19) continue;
      out[k] = {
        label: k,
        priceTtcCt: e.priceTtcCt ?? 0,
        tva: e.tva,
        unit: e.unit === 'KG' ? 'KG' : 'PIECE',
        vendor: typeof e.vendor === 'string' ? e.vendor : '',
        uses: typeof e.uses === 'number' ? e.uses : 0,
        lastUsedMs: typeof e.lastUsedMs === 'number' ? e.lastUsedMs : 0,
        pinned: e.pinned === true,
      };
    }
    return out;
  } catch { return {}; }
}

function saveMem(store: MemStore, mem: Record<string, RapideMemEntry>): void {
  try { store.setItem(RAPIDE_MEM_KEY, JSON.stringify(mem)); } catch { /* private mode */ }
}

/** Record a completed rapide add (call on submit). */
export function rememberRapideSale(
  store: MemStore,
  input: { label: string; priceTtcCt: number; tva: RapideTva; unit: RapideUnit; vendor?: string },
  nowMs = Date.now(),
): Record<string, RapideMemEntry> {
  const mem = loadRapideMemory(store);
  const label = input.label.trim();
  const prev = mem[label];
  mem[label] = {
    label,
    priceTtcCt: input.priceTtcCt,
    tva: input.tva,
    unit: input.unit,
    vendor: input.vendor?.trim() ?? prev?.vendor ?? '',
    uses: (prev?.uses ?? 0) + 1,
    lastUsedMs: nowMs,
    pinned: prev?.pinned ?? false,
  };
  // Prune least-recent non-pinned past the cap.
  const keys = Object.keys(mem);
  if (keys.length > MEM_CAP) {
    const evictable = keys.filter(k => !mem[k].pinned).sort((a, b) => mem[a].lastUsedMs - mem[b].lastUsedMs);
    for (const k of evictable.slice(0, keys.length - MEM_CAP)) delete mem[k];
  }
  saveMem(store, mem);
  return mem;
}

/** Most-recent first (for the chips row). */
export function getRapideRecents(mem: Record<string, RapideMemEntry>, n = 8): RapideMemEntry[] {
  return Object.values(mem).sort((a, b) => b.lastUsedMs - a.lastUsedMs).slice(0, n);
}

/** Pinned tiles (catalog grid). */
export function getPinnedRapides(mem: Record<string, RapideMemEntry>): RapideMemEntry[] {
  return Object.values(mem).filter(e => e.pinned).sort((a, b) => b.lastUsedMs - a.lastUsedMs);
}

export function toggleRapidePin(store: MemStore, label: string): Record<string, RapideMemEntry> {
  const mem = loadRapideMemory(store);
  const e = mem[label.trim()];
  if (!e) return mem;
  e.pinned = !e.pinned; // pin is an ornament, not a use: lastUsedMs untouched
  saveMem(store, mem);
  return mem;
}
