# PROGRAM BLUEPRINT v2.0 — Baraka Market (Complete Rebuild Without Demolition)

**Status:** Ratified by owner 2026-11-01 · **ADR:** ADR-020 · **Supersedes:** `docs/ROADMAP.md` (Oct-26 era).
**Rule:** everything existing is kept, everything broken is fixed, everything
missing is added. Future development = adding modules, never surgery.

## 1. Owner decisions (locked)
- Pole display: **designed-in from day one** (HAL adapter, optional at runtime).
- Updates: **auto via GitHub Releases when online + manual USB/installer fallback**.
- Postes: **single till** (identity columns ready, no sync machinery).
- Cloud: **absolute zero** — not even optional backup. USB only.
- Users: **full RBAC** (cashier / manager / owner + PINs + lock screen + audit).
- Printing: **full professional** (80mm thermal + drawer + cutter + A4 + shelf labels).

## 2. KEEP — verified inventory (195/195 tests, 22 tables)
POS cockpit (AR/FR, dark/light, zero-mouse) · fiscal centimes engine + Art.136 ·
Ed25519 offline licensing (HWID 4-group, 50-sale/14-day trial) · cash sessions +
monotonic hash-chained Z · manager PIN (salted SHA-256) + void_log · hot backup
(VACUUM INTO + verify + quarantine restore) · Algerian reference catalog
(28 cats / 257 templates) + owner keygen · CSV importer (dry-run) · EAN-13 +
shelf labels (A4/80mm) · supplier BL + PMP · debt ledger + quittances Q ·
perishables + loss ledger · Tauri shell + `db_status` authority probe +
first-run provisioning · gold brand system.

## 3. FIX — diagnosed defects (evidence-backed)
- **F1 Sale commit lane:** POS commits to localStorage only; `/api/sales`
  uncalled → **T1**.
- **F2 Browser-side numbering** can collide with server `seq` → **T2**.
- **F3 No versioned migrations** (`user_version` untouched) → **T3**.
- **F4 Loopback unauthenticated** (charter gap) → **T4**.
- **F5 Light theme:** only Licence audited; 7 views remain → **T10**.
- **F6 Stale docs:** Oct-26 ROADMAP superseded by this file.

## 4. ADD — missing modules
- **A1 Pole-display adapter** (2×20 VFD / LCD, USB/RS232, ESC/POS text) —
  silent when absent, live total/item/change when present → T5.
- **A2 GitHub auto-updater** (tauri-plugin-updater, signed) + USB manual path → T9.
- **A3 Full RBAC matrix** (§7) + lock screen + audit trail → T8.
- **A4 Trigger-level ledger enforcement** (SQLite triggers, second defense) → T11.
- **A5 Soak/keyboard formal gates** (8h RAM<120MB, zero-mouse proof) → T11.

## 5. Lane architecture (single till, three states)
```
UI event → AppContext → fiscal-authority probe
 ├─ FISCAL_SQLITE (invoke db_status OK + loopback healthy)
 │    → POST /api/* (sales, voids, settlements, cash, Z, backups) → WAL DB
 ├─ DEGRADED (loopback absent) → local queue (active_cart_draft mirror)
 │    → auto-replay on reconnect, idempotency keys, NEVER renumber
 └─ PROVISIONAL (first run) → amber banner until first successful commit
```
**Law:** fiscal IDs ONLY from server `seq` (pad-6 `FACT/T/Q/Z-YYYY-XXXXXX`).
`sales.length`-style numbering is a defect wherever found.

## 6. HAL — hardware abstraction (evolvability spine)
`PrinterPort | ScalePort | DisplayPort` interfaces; ESC/POS engine pure.
New device = new adapter file + 1 registration line. Core engines
(`fiscal.centimes`, `escpos`, `licensing`, `zreport`…) stay dependency-free
and browser-testable forever.

## 7. RBAC matrix
| Capability | Cashier | Manager | Owner |
|---|---|---|---|
| Sell / settle / print | ✅ | ✅ | ✅ |
| Void sale / edit price | ❌ (request) | ✅ (PIN + logged) | ✅ |
| Close day / Z | ❌ | ✅ | ✅ |
| Backups / restore | ❌ | restore | ✅ |
| Users / PINs / rates | ❌ | ❌ | ✅ |
Lock screen after inactivity; every override writes `void_log`/audit.

## 8. Updater design
GitHub Releases channel (signature-verified, staged rollout flag) +
**USB path:** installer `.exe` runs standalone, migrates DB via §9, never
touches shop config. Offline-first: update NEVER blocks checkout.

## 9. Evolvability contract (every future task obeys)
1. Core stays pure (no I/O imports in `src/core`, `src/hardware` w/o adapter).
2. DB changes ONLY via versioned migrations + tests (old DB → latest, intact).
3. Stable `invoke`/REST contracts; breaking change = new route version + ADR.
4. New hardware = adapter, never core edits. 5. Every change: ADR + context
   update + tests + (UI → screenshots). 6. Zero-cloud, centimes-only, pad-6 —
   violations fail review.

## 10. Task map (approved, flexible)
T1 sale commit · **DONE (ADR-021 slice A + ADR-022 slice B, 205/205, live-wire proven)** · T2 single-lane seq · **FULLY DONE (ADR-023 sale lane + ADR-024 settlement lane T2b, Q via server seq, 214/214, live-wire proven)** · T3 migrations · **DONE (ADR-021 foundation + v3 step in ADR-024, tested)** · T4 loopback token · **DONE (ADR-025, 401 gate + shell relay, 215/215, cargo check clean)** → T4b prod commit lane · **DONE (ADR-026, Rust record_sale/record_settlement + invoke-first commit*, 219/219 + Rust 4/4, contract match)** → T4c product/stock truth · **DONE (ADR-027, product_upsert/list/search + one-way catalog mirror, 222/222 + Rust 7/7)** → T5 pro printing + pole display · **DONE (ADR-028, VFD compiler + print-lane + spool split + modal/commit wiring, 234/234, live bytes reconciled)** → T6 RS-232 scale · **DONE (ADR-029, frame parser + stability voter + Web Serial live lane + modal button, 241/241; native serial deferred to T6b)** → T7 power-cut drill · **DONE (ADR-030, real SIGKILL mid-commit: isolation + BUSY + clean recovery + replay-once, 243/243)** → T8 full RBAC · **DONE (ADR-031, users + salted PIN + 5-strike lockout + audit on both lanes + session gate + role nav + live E2E owner/1234→5678→POS, 258/258 + Rust 11/11)** ·
T9 updater · **DONE (ADR-032 …)** · T10 light audit · **DONE (ADR-033, sale/settlement/void/Z actor-stamped, 262/262 + Rust 11/11)** · T11 soak/keyboard/triggers · **DONE (ADR-034, 7 append-only triggers v5 + login keys + KEYBOARD-MAP + soak 500 green 0.83ms/sale, 265/265 + Rust 13/13)** · T12 gold-master rehearsal + `v1.1.0` tag.

## 11. Shop-ready definition
Fresh install → seed → sell → void (manager) → settle debt → Z close →
backup → restore → identical Z; 8h soak green; full sale keyboard-only;
light+dark clean; docs current. Then — and only then — المحل يفتح.
