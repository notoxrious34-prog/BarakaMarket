# CONSTITUTION OF THE EXECUTOR — v2-MKT

**Ratified:** 2026-10-27 · **Charter:** v2.0-MKT (Baraka Market — Supermarket POS System)
**Executor:** Muse Spark 1.3 Contributor (Hermes platform)
**Authority:** Subordinate to the Master Principal Architect & Design Lead. This
document binds every executor turn. On conflict between speed and law, law wins.

---

## 1. Stack Invariants (audited baseline, TASK-AUD-001-MKT)

| Layer | Ratified choice |
|---|---|
| Shell | **Tauri v2** (`tauri = "2"`, config schema `config/2`, NSIS bundle) |
| UI | **React 19** + TypeScript **strict** (`tsc --noEmit` is the lint gate) |
| Build | **Vite 8** + Tailwind CSS v4 |
| Runtime | Node 26 (loopback API `127.0.0.1:3100` + browser lane) |
| Database | **SQLite** — `rusqlite 0.32 (bundled)` native, `node:sqlite` server lane; **WAL + `foreign_keys=ON` + `synchronous=NORMAL`** on every open |

No engine substitution (.NET, Electron, cloud DB, ORM) without a new ADR.

## 2. Financial Laws (non-negotiable)

1. **Absolute zero floats in financial paths.** Money is strictly integer
   centimes (`INTEGER …_ct` / `i64` domain, DZD×100). SQLite CHECKs and
   `assertIntegerCentimes` guards are the last line of defense.
2. **Quantities are integer milli-units** (`qty_milli`, `stock_milli`; 1.45 kg → 1450).
3. **Rounding rule: ROUND_HALF_UP** at the centime boundary, applied once per
   computation stage — never chained float divisions in display code.
4. **TVA brackets are exactly 0 / 9 / 19**, enforced by DB CHECK constraints.
5. **Sequences are monotonic and SQLite-owned** (`seq` table, `UPDATE…RETURNING`,
   `FACT/T/Q/Z-YYYY-XXXXXX`). `sales.length+1` style pseudo-sequences are forbidden.
6. **Art. 136 timbre** applies to every ESPECES inflow ≥ 50.00 DZD, including
   debt settlements — collected ON TOP, never deducted from the debt.

## 3. Supermarket Domain Laws

1. **Zero network dependencies for checkout.** The sale loop (scan → totals →
   ticket) must complete offline; loopback/Tauri are enhancements, never requirements.
2. **Scanner buffer priority.** HID burst traffic (≤30 ms gaps, Enter-terminated)
   wins over human typing; scans must land even when the barcode field lost focus.
3. **Variable-weight barcode envelope: prefixes 20, 21, 22, 28, 29**
   (embedded weight/price). Gaps are tracked in the ADR registry until closed.
4. **ESC/POS output must be deterministic bytes** (`Uint8Array`, drawer kick
   `1B 70 00 19 FA`, cut `1D 56 42 00`) with a printable-spool fallback — never
   printer-driver-dependent for the fiscal record.
5. **Z-report closures are hash-chained** (`SHA-256(prev‖number‖date‖ttc‖timbre)`)
   and immutable once finalized.

## 4. Tooling & Gate Protocol

* **Permitted task prefixes:** `TASK-AUD-*` (audit), `TASK-BRK-*` (baseline/breaking),
  `TASK-DSN-*` (design), `TASK-REL-*` (release). Work outside these prefixes needs
  explicit architect approval.
* **Gate command: `npm run test:all`. It must never regress below 58/58.**
  `npm run lint` (0 errors) and `npm run build` (dist < 2.5 MB) are co-gates.
* **No unapproved npm packages.** Every dependency addition needs a stated
  demonstrated need; cloud/telemetry SDKs are banned (Zero-Cloud invariant).
* **Smallest coherent change.** No drive-by refactors; no unrelated files; no
  commits/tags unless explicitly instructed.
* **Read-only audits stay read-only:** no source/migration edits, no leftover
  diagnostic scripts, no touching live data dirs (`%APPDATA%`, `%LOCALAPPDATA%`).

## 5. Handoff & Reporting Format

Every task closes with exactly:

* **STATE:** [Complete / Partial]
* **DONE:** [items with file:line / command evidence]
* **REMAINING:** [unchecked items, or "none"]
* **EVIDENCE:** [terminal outputs, hashes, counts — never prose in place of proof]
