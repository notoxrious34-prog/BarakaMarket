/**
 * C5 (PLAN-v1.2.0): customizable POS shortcuts.
 * Defaults mirror docs/KEYBOARD-MAP.md. Overrides live in localStorage
 * (`baraka_shortcuts_v1`) as {action: combo}; a combo is `e.key` optionally
 * prefixed with `Alt+`. Cockpit structural keys (Enter/Escape/2/3) stay
 * hardcoded — only the action matrix below is remappable.
 */
import type { StorageLike } from './sale-outbox';

/** Minimal removal-capable store (localStorage in the app, Map in tests). */
export interface ShortcutStore extends StorageLike {
  removeItem(key: string): void;
}

export const SHORTCUTS_KEY = 'baraka_shortcuts_v1';

export type ShortcutAction =
  | 'pos.search' | 'pos.qty' | 'pos.discount' | 'pos.hold' | 'pos.recall'
  | 'pos.scale' | 'pos.filter' | 'pos.credit' | 'pos.settle' | 'pos.checkout' | 'pos.lock'
  | 'pay.exact' | 'pay.1000' | 'pay.2000' | 'pay.5000';

/** Canonical defaults — keep in sync with docs/KEYBOARD-MAP.md. */
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[]> = {
  'pos.search': ['F1'],
  'pos.qty': ['F2'],
  'pos.discount': ['F3'],
  'pos.hold': ['F4'],
  'pos.recall': ['F5'],
  'pos.scale': ['F6'],
  'pos.filter': ['F7'],
  'pos.credit': ['F9'],
  'pos.settle': ['F12'],
  'pos.checkout': [' '],
  'pos.lock': ['F10'],
  'pay.exact': ['F1', 'Alt+1'],
  'pay.1000': ['F2', 'Alt+2'],
  'pay.2000': ['F3', 'Alt+3'],
  'pay.5000': ['F4', 'Alt+4'],
};

export const SHORTCUT_ACTIONS = Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[];

export type ShortcutOverrides = Partial<Record<ShortcutAction, string>>;

/** `Alt+1`, `F1`, ` ` … from a KeyboardEvent-like. */
export function describeKey(e: { key: string; altKey?: boolean }): string {
  return `${e.altKey ? 'Alt+' : ''}${e.key}`;
}

function readOverrides(store: ShortcutStore): ShortcutOverrides {
  try {
    const raw = store.getItem(SHORTCUTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: ShortcutOverrides = {};
    for (const a of SHORTCUT_ACTIONS) {
      if (typeof parsed[a] === 'string' && (parsed[a] as string).length > 0 && (parsed[a] as string).length <= 8) {
        out[a] = parsed[a] as string;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Effective combos: override wins, else defaults. */
export function effectiveCombos(store: ShortcutStore): Record<ShortcutAction, string[]> {
  const ov = readOverrides(store);
  const out = {} as Record<ShortcutAction, string[]>;
  for (const a of SHORTCUT_ACTIONS) out[a] = ov[a] ? [ov[a] as string] : DEFAULT_SHORTCUTS[a];
  return out;
}

/** First action of the given mode whose combo matches the event, or null.
 * Modes are separate lanes: F1 is `pos.search` in the POS and `pay.exact`
 * in the cockpit — same key, different context, no conflict. */
export function resolveAction(
  e: { key: string; altKey?: boolean },
  store: ShortcutStore,
  scope: 'pos' | 'pay',
): ShortcutAction | null {
  const combo = describeKey(e);
  const eff = effectiveCombos(store);
  for (const a of SHORTCUT_ACTIONS) {
    if (!a.startsWith(scope)) continue;
    if (eff[a].includes(combo)) return a;
  }
  return null;
}

/** Remap one action; refuses combos already taken in the SAME mode. */
export function setShortcut(
  store: ShortcutStore,
  action: ShortcutAction,
  combo: string,
): { ok: true } | { ok: false; conflict: ShortcutAction } {
  const clean = combo.trim();
  if (!clean) return { ok: false, conflict: action };
  const mode = action.split('.')[0];
  const eff = effectiveCombos(store);
  for (const a of SHORTCUT_ACTIONS) {
    if (a === action || !a.startsWith(mode)) continue;
    if (eff[a].includes(clean)) return { ok: false, conflict: a };
  }
  const ov = readOverrides(store);
  if (DEFAULT_SHORTCUTS[action].includes(clean)) delete ov[action];
  else ov[action] = clean;
  store.setItem(SHORTCUTS_KEY, JSON.stringify(ov));
  return { ok: true };
}

export function resetShortcuts(store: ShortcutStore): void {
  store.removeItem(SHORTCUTS_KEY);
}
