/**
 * C5: shortcut registry — defaults, persistence, conflict refusal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHORTCUTS, describeKey, effectiveCombos, resetShortcuts,
  resolveAction, setShortcut, SHORTCUT_ACTIONS,
} from './shortcuts.js';

function memStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k) as string : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

test('C5: defaults mirror KEYBOARD-MAP (spot-check)', () => {
  assert.deepEqual(DEFAULT_SHORTCUTS['pos.search'], ['F1']);
  assert.deepEqual(DEFAULT_SHORTCUTS['pos.hold'], ['F4']);
  assert.deepEqual(DEFAULT_SHORTCUTS['pos.checkout'], [' ']);
  assert.deepEqual(DEFAULT_SHORTCUTS['pay.exact'], ['F1', 'Alt+1']);
  assert.equal(SHORTCUT_ACTIONS.length, 15);
});

test('C5: resolve is mode-scoped (F1 = search in POS, exact in pay)', () => {
  const s = memStore();
  assert.equal(describeKey({ key: '1', altKey: true }), 'Alt+1');
  assert.equal(resolveAction({ key: 'F4' }, s, 'pos'), 'pos.hold');
  assert.equal(resolveAction({ key: 'F4' }, s, 'pay'), 'pay.5000');
  assert.equal(resolveAction({ key: '1', altKey: true }, s, 'pay'), 'pay.exact');
  assert.equal(resolveAction({ key: 'F8' }, s, 'pos'), null);
});

test('C5: override persists and survives reload; default restored on match', () => {
  const s = memStore();
  assert.deepEqual(setShortcut(s, 'pos.hold', 'F8'), { ok: true });
  assert.equal(resolveAction({ key: 'F8' }, s, 'pos'), 'pos.hold');
  // cross-mode twin untouched: pay lane still answers F4→5000
  assert.equal(resolveAction({ key: 'F4' }, s, 'pay'), 'pay.5000');
  assert.equal(effectiveCombos(s)['pos.hold'].length, 1);
  // re-pointing at its own default clears the override
  assert.deepEqual(setShortcut(s, 'pos.hold', 'F4'), { ok: true });
  assert.deepEqual(effectiveCombos(s)['pos.hold'], ['F4']);
  resetShortcuts(s);
  assert.equal(resolveAction({ key: 'F8' }, s, 'pos'), null);
});

test('C5: conflicts refused within a mode (no double-binding), garbage ignored', () => {
  const s = memStore();
  const r = setShortcut(s, 'pos.recall', 'F4');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.conflict, 'pos.hold');
  assert.equal(resolveAction({ key: 'F4' }, s, 'pos'), 'pos.hold');
  // cross-mode twin allowed: pay.exact may also claim F8
  assert.deepEqual(setShortcut(s, 'pay.exact', 'F8'), { ok: true });
  s.setItem('baraka_shortcuts_v1', '{oops');
  assert.equal(resolveAction({ key: 'F1' }, s, 'pos'), 'pos.search');
});
