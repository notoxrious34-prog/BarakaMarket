# TASK-TEMPLATE — صيغة صياغة المهام الخارجية الموحدة
**Protocol:** Context-Pack v1 (owner-ratified 2026-11-01). **Rule:** any task
copied from here must be pasted VERBATIM to the executor — the owner never
rewords, only fills the `☐` fields.

---

## MODEL (copy this block per task)

```
TASK-[ID] — [TITLE]
Owner decision ref: [date + one-line approval]
Objective (ONE sentence, measurable): …
IN SCOPE:  1) … 2) …
OUT OF SCOPE (explicit): …
Files allowed: [exact paths — executor touches NOTHING else]
Reference read-only: [paths to read first]
Acceptance gates (ALL must be shown with real output):
  G1: [command] → [expected result, e.g. tests 199/199]
  G2: [file:line evidence, e.g. screenshot path or log line]
Prohibitions: [e.g. no float money · no new deps · no C: paths · no UI text change]
Evidence to return: [test log tail + git diff --stat + listed artifacts]
Rollback: [how to undo — default: git stash / git checkout -- <files>]
```

## FILLED EXAMPLE (ready to paste — T10 slice: Licence view was done, do Stock)

```
TASK-T10b — Light-theme audit: ProductsStockView
Owner decision ref: 2026-11-01 — Blueprint v2.0 T10 approved.
Objective (ONE sentence, measurable): every text/control in ProductsStockView
  readable in html.light at 1366×768 with zero console errors.
IN SCOPE:  1) audit + fix only src/components/Inventory/ProductsStockView.tsx
  2) use existing force-dark/chip patterns from LicenseManagerView — no new CSS system.
OUT OF SCOPE (explicit): dark theme · other views · any logic/behavior change.
Files allowed: src/components/Inventory/ProductsStockView.tsx (+ screenshots to cache/scratch/qa/).
Reference read-only: src/components/License/LicenseManagerView.tsx, src/index.css.
Acceptance gates (ALL must be shown with real output):
  G1: npm run lint → clean; npm run test:all → 199/199 (no test change expected).
  G2: two screenshots (light 1366×768 full view + zoom on worst control) inspected,
      every label contrast-readable, returned as MEDIA paths.
Prohibitions: no behavior change · no new dependencies · no C: temp paths.
Evidence to return: tail of lint/test logs + git diff --stat + 2 screenshot paths.
Rollback: git checkout -- src/components/Inventory/ProductsStockView.tsx
```

## CHECKLIST FOR THE OWNER (before sending)
- [ ] ID unique, title matches Blueprint task.
- [ ] Files allowed are exact — nothing else editable.
- [ ] Gates contain literal commands + literal expected outputs.
- [ ] Evidence list tells you exactly what to look at.
- [ ] Rollback is one command.
