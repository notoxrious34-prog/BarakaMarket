# ADR-008-MKT: Pixel-Perfect Refinement & Theme Harmony

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Pixel inspection in both themes found: a reported stray `{` in the navbar, a
clipped `Caisse (F1)` tab, a clipped `Tous les rayons` pill, a dark-slate
disabled checkout button glowing active in Light Mode, a hard-coded dark
status footer, and F1 claimed by three different labels.

## Decision

1. **Stray brace:** no standalone `{` exists in `Navbar.tsx` (a literal JSX
   `{` is a compile error; `tsc` is green). No deletion was needed — reported
   as verified-absent, likely a GRIM artifact.
2. **Navbar clipping:** rail is now `flex-1 min-w-0` so it absorbs free space
   and scrolls internally instead of squeezing; every tab (incl. settings
   gear) is `flex-shrink-0` with `whitespace-nowrap`; brand stays `shrink-0`.
3. **Category rail:** container gains `px-2` start padding; pills already
   `flex-shrink-0` (ADR-007).
4. **Disabled checkout:** exact task string
   `bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500
   border border-slate-300 dark:border-slate-700 cursor-not-allowed
   opacity-60` — wired by the key fix below.
5. **Root cause — `dark:` was dead:** Tailwind v4 defaults `dark:` to
   `prefers-color-scheme`, ignoring the app's `.light`/`.dark` class toggle
   (zero existing `dark:` usages). `index.css` now declares
   `@custom-variant dark (&:where(.dark, .dark *))` so `dark:` follows the
   toggle. Status footer harmonized to
   `bg-slate-100 dark:bg-[#070a0f] border-slate-200 dark:border-[#162030]`
   with theme-aware inner text (`App.tsx` footer — one className touch,
   outside nominal scope, called out here).
6. **F1:** reserved strictly for barcode-input focus (PosView handler,
   search placeholder, footer hint all agree). The `(F1)` suffix was removed
   from the navbar Caisse tab (F1 never navigated). Exception: inside the
   PaymentModal cockpit, F1 = Exact-amount (ADR-005 capture matrix, modal
   pre-empts POS keys while open).

## Consequences

* Positive: no clipped tabs in either language direction; disabled reads as
  disabled in both themes; `dark:` is now a working tool for future DSN work.
* Accepted: footer badges keep emerald/amber (legible on both grounds);
  `html.light .force-dark` opt-outs untouched.
