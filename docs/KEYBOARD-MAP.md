# KEYBOARD-MAP (T11 — audited from code, not designed on paper)

Zero-Mouse <150ms is constitutional. Every till flow below is completable
without touching the mouse. Sources: `PosView.tsx` (global layer),
`PaymentModal.tsx` (checkout matrix), `LoginScreen.tsx` (lock screen).
F8 is intentionally unbound (reserved for the second-cash-register lane).

## POS floor (`PosView`)

| Key | Action | Guard |
|---|---|---|
| F1 | Focus + select barcode field | always (even in inputs) |
| F2 | Quantity override for current/last line | cart non-empty |
| F3 | Line discount (percent or fixed DZD) | cart non-empty |
| F4 | Hold current cart | cart non-empty |
| F5 | Restore first held cart | held carts exist |
| F6 | Toggle scale modal (weighing) | always |
| F7 | Catalog quick-search (↑/↓ + Enter) | always |
| F9 / Space / F12 | Checkout (F12 = settlement cockpit) | cart non-empty |
| F10 | Lock / unlock session | always; when locked every other key is ignored |

## Checkout (`PaymentModal`, capture phase — pre-empts the POS layer)

| Key | Action |
|---|---|
| F1 / Alt+1 | Exact amount |
| F2 / Alt+2 | 1000 tendered |
| F3 / Alt+3 | 2000 tendered |
| F4 / Alt+4 | 5000 tendered |
| 2 / 3 (outside inputs) | Tender DAHABIYA / CREDIT |
| Enter | Finalize (empty = exact) → print |
| Escape | Cancel checkout |
| HUD: Enter / Space / Escape / any char / click | Dismiss |

## Lock screen (`LoginScreen`, T11 addition)

| Key | Action |
|---|---|
| 0–9 | PIN digit (login, new PIN, confirm PIN) |
| Backspace | Erase one digit (pad `C` wipes all) |
| Enter | OK: new → confirm → submit |
| Escape | Clear field |

## Shop rule

If a future flow cannot be driven keyboard-only, it ships DISABLED until the
keys exist. This file is updated with the code, never after it.
