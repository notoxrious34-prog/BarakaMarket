# TEST REPORT — Baraka Market v1.0.0-GA
Date: 2026-10-27 · Commit: `fd23dd7` (tag `v1.0.0`) · Runner: `npm run test:all` (tsx --test, node:test) · `npm run lint` (tsc --noEmit) · `npm run build` (vite)

| Suite | File | Tests | Result |
|---|---|---|---|
| Centimes engine | src/core/fiscal.centimes.test.ts | 18 | ✅ 18/18 |
| UI bridge parity (grid + golden) | src/core/cart-bridge.test.ts | 2 | ✅ 2/2 |
| Settlement fiscal (Art.136) | src/core/settlement.fiscal.test.ts | 4 | ✅ 4/4 |
| Licensing (Ed25519) + SHA-256 cross-check | src/core/licensing.test.ts | 13 | ✅ 13/13 |
| Z-report chain | src/core/zreport.test.ts | 4 | ✅ 4/4 |
| ESC/POS thermal buffers | src/hardware/escpos.test.ts | 7 | ✅ 7/7 |
| Scanner burst + scale | src/hardware/scanner.test.ts | 5 | ✅ 5/5 |
| Synthesized audio | src/hardware/sound.test.ts | 2 | ✅ 2/2 |
| Legacy accounting (no regression) | src/utils/accounting.test.ts | 2 | ✅ 2/2 |
| SQLite WAL layer + colisage DAL | src/db/sqlite.test.ts | 14 | ✅ 14/14 |
| Z-report persistence | src/db/zreport.test.ts | 2 | ✅ 2/2 |
| Live API (loopback + raw-print) | server/index.test.ts | 18 | ✅ 18/18 |
| Colisage math (pure) | src/core/colisage.test.ts | 5 | ✅ 5/5 |
| Cash tender math (pure) | src/core/cash-tender.test.ts | 8 | ✅ 8/8 |
| Loss ledger + expiry radar | src/db/loss.test.ts | 9 | ✅ 9/9 |
| Bulk CSV import engine | src/core/csv-importer.test.ts | 12 | ✅ 12/12 |
| Shelf-edge labels + EAN-13 | src/core/shelf-labels.test.ts | 10 | ✅ 10/10 |
| Supplier BL receiving | src/db/purchases.test.ts | 14 | ✅ 14/14 |
| Client credit settlement | src/db/settlement.test.ts | 10 | ✅ 10/10 |
| Cash sessions + Z closure | src/db/cash-session.test.ts | 7 | ✅ 7/7 |
| Void audit + PIN gate | src/db/void-log.test.ts | 9 | ✅ 9/9 |
| Manager PIN + override | src/core/security.test.ts | 4 | ✅ 4/4 |
| Online backup + restore | src/db/backup.test.ts | 7 | ✅ 7/7 |
| Reference catalog (28 cats, 257 tpl, BiDi, search) | src/core/reference-catalog.test.ts | 8 | ✅ 8/8 |
| Reference templates REST lane | server/index.test.ts | +1 | ✅ 1/1 |
| Idempotent commit + v1→v2 migration (T1 slice A, ADR-021) | src/db/idempotency.test.ts | 4 | ✅ 4/4 |
| Offline outbox + idempotent replay (T1 slice B, ADR-022) | src/core/sale-outbox.test.ts | 6 | ✅ 6/6 |
| Single-lane numbering guard, DRAFT refs (T2 sale lane, ADR-023) | src/context/browser-lane.test.ts | 3 | ✅ 3/3 → 4/4 |
| Settlement idempotency + v2→v3 migration (T2b, ADR-024) | src/db/idempotency.test.ts | +3 | ✅ 3/3 |
| Outbox kind routing + backward compat (T2b) | src/core/sale-outbox.test.ts | +2 | ✅ 2/2 |
| Loopback write token: 401/401/200 gate (T4, ADR-025) | server/index.test.ts | +1 | ✅ 1/1 |
| Native-first commit lane: fallback/id-forwarding/down→null (T4b, ADR-026) | src/core/commit-lane.test.ts | +4 | ✅ 4/4 |
| Product mirror mapping + no-op contract (T4c, ADR-027) | src/core/product-authority.test.ts | +3 | ✅ 3/3 |
| Pole-display VFD frames: 20-col exact + brightness + determinism (T5, ADR-028) | src/hardware/pole-display.test.ts | +6 | ✅ 6/6 |
| Unified print lane: spool contract + Lane B fallback (T5, ADR-028) | src/core/print-lane.test.ts | +5 | ✅ 5/5 |
| Scale frames + stability voter + serial guard (T6, ADR-029) | src/hardware/scale.test.ts | +7 | ✅ 7/7 |
| Power-cut drill: real kill, clean recovery, replay-once (T7, ADR-030) | src/db/powercut-drill.test.ts | +2 | ✅ 2/2 |
| RBAC core: hierarchy + lockout/backoff math + session liveness (T8, ADR-031) | src/core/rbac.test.ts | +3 | ✅ 3/3 |
| Session bridge: verify shape + lockout surface + down-lane safety (T8, ADR-031) | src/core/session-authority.test.ts | +3 | ✅ 3/3 |
| Users DAL: seed + verify/lockout + CRUD + audit + legacy climb (T8, ADR-031) | src/db/rbac.test.ts | +4 | ✅ 4/4 |
| Pole spool routing `spool: pole-display-spool.bin` (T5, ADR-028) | server/index.test.ts | +1 | ✅ 1/1 |
| T8 users lane: verify + owner-only create + lockout + audit | server/index.test.ts | +1 | ✅ 1/1 |
| T8 self-auth without token; rest stays 401-gated | server/index.test.ts | +1 | ✅ 1/1 |
| CORS preflight 204 + `*` on reads (T8, ADR-031) | server/index.test.ts | +1 | ✅ 1/1 |
| Update lane: semver math + native-only degrade (T9, ADR-032) | src/core/update-lane.test.ts | +2 | ✅ 2/2 |
| T10 void → sale.void audit row (actor + reason) | server/index.test.ts | +1 | ✅ 1/1 |
| T10 close-and-z → z.close audit row (actor + Z + diff) | server/index.test.ts | +1 | ✅ 1/1 |
| T11 triggers: append-only + terminal-state, legacy v4→v5 climb (ADR-034) | src/db/triggers.test.ts | +3 | ✅ 3/3 |
| **Total** | **37 files** | **265** | **✅ 265/265, 0 fail** |

## Phase 2 — v1.2.0 (2026-11-02 · `tsc + lint + build` clean)
| Suite | File | Tests | Result |
|---|---|---|---|
| B1 linguistic unification guard (forbidden strings) | src/core/linguistic-guard.test.ts | 2 | ✅ 2/2 |
| B3 `N*CODE` qty-prefix parser (plain/split/clamp/scale-fuzzy) | src/core/barcode-qty.test.ts | 4 | ✅ 4/4 |
| B4 close-and-z gap reason persisted in `z.close` audit detail | server/index.test.ts | +1 | ✅ 1/1 |
| **Total** | **42 files** | **278** | **✅ 278/278, 0 fail** |
Live proofs: B2 daylight screenshots + computed-style audit 13/13 ≥4.5:1; B3 `12*`→12 + field 12→3 + RTL stepper/bidi; B4 blocked→unblocked close + reason in audit; B5 5 tabs + NIF lock screenshot. Full lane visual tour in session history.

## Phase 3 — v1.3.0 (2026-11-02 · `tsc + lint + build` clean)
| Suite | File | Tests | Result |
|---|---|---|---|
| C1 touch keypad: digits/00/C/back/MAX_LEN guard | src/core/touch-amount.test.ts | 4 | ✅ 4/4 |
| C2 statement ledger: chrono sort + running balance + overpayment | src/core/statement-ledger.test.ts | 3 | ✅ 3/3 |
| C3 ceiling-bar thresholds + unlimited + class map | src/core/ceiling-bar.test.ts | 2 | ✅ 2/2 |
| C4 expiry buckets + tz-proof midnight + bad-date safety | src/core/expiry-bucket.test.ts | 2 | ✅ 2/2 |
| C5 registry defaults + mode scope + persist + conflict + garbage | src/core/shortcuts.test.ts | 4 | ✅ 4/4 |
| **Total** | **47 files** | **293** | **✅ 293/293, 0 fail** |
Live proofs: PAY-C1 keypad + chips + TVA/timbre; DEBTS-C3 ceiling bars; STOCK-FIX full-width expiry strip; SHORT-C5 matrix + live remap `{"pos.hold":"F8"}` persisting reload. Footer OCR note: `SQLITE WAL` verified exact in DOM.

### Rust lane (T4b, ADR-026 — `cargo test`, same invariants, real SQLite)
| Area | File | Tests | Result |
|---|---|---|---|
| Native sale commit + dedupe by key (stock drains once) | src-tauri/src/fiscal.rs | 1 | ✅ |
| Broken invariant rejected, zero rows written | src-tauri/src/fiscal.rs | 1 | ✅ |
| Native settlement commit + dedupe + balance | src-tauri/src/fiscal.rs | 1 | ✅ |
| Faithful v1 DDL climbs to v4 + owner seed (dual-lane migration, T8) | src-tauri/src/fiscal.rs | 1 | ✅ |
| Native product upsert/list/search (T4c, ADR-027) | src-tauri/src/product.rs | +3 | ✅ |
| SHA-256 NIST vectors + verifier round-trip + native lockout + migrate_v4 seed (T8, ADR-031) | src-tauri/src/auth.rs | +4 | ✅ |
| Legacy climb restores triggers on v5 (T11, ADR-034) | src-tauri/src/fiscal.rs | +1 (climb assert) | ✅ |
| Raw-SQL abuse blocked: deletes + CANCELLED resurrection (T11) | src-tauri/src/fiscal.rs | +1 | ✅ |
| Audit/users append-only under direct SQL (T11) | src-tauri/src/auth.rs | +1 | ✅ |
| Native PIN change: wrong-old/format rejected, flag cleared (T12, ADR-035) | src-tauri/src/auth.rs | +1 | ✅ |
| **Total Rust** | **3 files** | **14** | **✅ 14/14, 0 fail** |
| `cargo check --offline` | main.rs + fiscal.rs | compile | ✅ clean |

- `tsc --noEmit`: EXIT 0, empty log.
- `vite build`: success, `dist/` 1.6MB (< 2.5MB gate), zero warnings.
- Gate floor: must never regress below 58/58 (Constitution v2-MKT §4) — **271/271 + Rust 14/14 holds (Phase 1 v1.1.1)**.
- Phase 1 v1.1.1 (PLAN-v1.2.0) DONE on iron: A1 outbox badge (pending/failed) + inspector panel (retry / owner-gated audited discard via `removeOutboxEntry` + `sale.void` audit) + DRAFT unposted stamp; A2 legacy-boot (`splitSchemaIndexes`, `golden-legacy.test.ts`, `GOLD OPENS v5/36`); A3 live `APP_VERSION` + `version-guard.test.ts` (footer/updater/ticket/index.html — `V1.1.1` on iron); A4 timbre-min disclosure. Live proof: server-down sale → `1 بانتظار الإرسال`; stale `SALE-1793563229219` surfaced red → owner discard → `sales=0`, `outbox=[]`, audit row `outbox discard … by owner`. Release `v1.1.1` signed `SIG-OK [ED]`, silently installed (6988800 B) + smoke + login E2E.
- ADR-017-MKT (2026-10-26): Algerian reference catalog (257 templates/112 brands,
  28 fiscal categories, BiDi sanitizer, token scorer), `ref_*` seed + REST lane,
  product-modal autofill, standalone Owner keygen GUI with seal self-check.
- ADR-015-MKT (2026-10-27): VACUUM INTO hot snapshots with SHA-256 journal,
  tamper-evident catalog, magic-bytes + integrity pre-flight, quarantine-first
  restore drill with server re-provisioning, 4 backup REST lanes.
- ADR-014-MKT (2026-10-27): salted SHA-256 manager PIN (constant-time,
  default 1234), override bridge for 4 gated actions, append-only void
  journal coexisting with sale voids, 5 security REST lanes.
- ADR-013-MKT (2026-10-27): cash sessions (float/movements/live
  theoretical), atomic Z closure reusing the hash chain, bilingual thermal Z
  ticket with DEFICIT/EXCEDENT/PARFAIT verdict, 4 cash REST lanes.
- ADR-012-MKT (2026-10-27): Carnet de Dette settlement (atomic balance +
  Art.136 timbre + Q-seq), credit ceiling gate, bilingual thermal quittance,
  3 client REST lanes.
- ADR-011-MKT (2026-10-27): supplier BL engine — atomic influx (packs×mult×1000),
  HT/TVA/TTC line splits, buy/sell cost refresh, balance_due_ct debt, 3 REST lanes.
- ADR-010-MKT (2026-10-27): EAN-13 vector SVG (L/G/R + guards) + A4 3×8 HTML
  sheets + 80mm thermal strips with scissor lines; 2 label REST endpoints.
- ADR-009-MKT (2026-10-27): zero-dep CSV importer (`;`/`,` auto-detect, FR/EN
  aliases, dry-run preflight) + atomic `importProductsBatch` (UPSERT/INSERT_ONLY)
  + 2 REST endpoints; real-schema mapping (no price_ct/updated_at).
- ADR-008-MKT (2026-10-27): pixel refinement — navbar rail flex-1/min-w-0 +
  shrink-0 tabs, Caisse (F1)→Caisse, rail px-2, theme-aware disabled checkout
  + `@custom-variant dark` root-cause fix, light-harmonized status footer.
- ADR-007-MKT (2026-10-27): cockpit layout — min-h-0 flex discipline, category
  rail scroll, Balance/Hold dedup into navbar, empty-cart checkout guard,
  high-contrast DLC badge. Layout-only; no fiscal/DAL/licensing touched.
- ADR-006-MKT (2026-10-27): inventory_losses ledger (6-reason CHECK, RESTRICT,
  BEGIN IMMEDIATE atomic write-off) + expiry radar query + 3 REST endpoints.
- ADR-005-MKT (2026-10-27): cash cockpit — centimes tender engine + smart DA presets;
  F1-F4/Alt+1-4 capture matrix, Enter-empty=exact, text-5xl change, z-70 Change HUD
  with scanner/Enter/Space/Esc dismiss + barcode re-arm; F12 cockpit entry.
- ADR-003-MKT (2026-10-27): universal scale parser (20/21/22/28/29, EAN-13 gate).
- ADR-004-MKT (2026-10-27): product_barcodes (alias x1 / pack xN + override);
  scan priority scale → primary → alias → fuzzy; pack-aware qty_milli drain.

## Phase 4 — v1.3.1 → v1.3.3 (cockpit + owner keygen, 2026-11-02)
| Slice | Change | Files | Result |
|---|---|---|---|
| v1.3.1 KeyPad unification (owner note) | shared `Key`/`KeyPad` caps payment + login PIN; role by text color only | `src/components/ui/KeyPad.tsx` | ✅ 293/293 holds |
| v1.3.2 cash cockpit two-column | keypad RIGHT (first in RTL, 248px, big keys) + tender left; cash-only `max-w-3xl` | `src/components/POS/PaymentModal.tsx` | ✅ lane COCKPIT 4/4 (columns, right side, big uniform keys, no overlap) |
| BarakaKeygen v2 (owner desk) | menu: generate → verify → history → quit; queue line-reader (pipe+TTY); `keygen-history.log` beside exe | `scripts/keygen-sea.ts`, `releases/BarakaKeygen.exe` (103MB) | ✅ `CHECK: VALID` + VERIFY VALID/INVALID + clean quit, all via piped stdin |
| v1.3.3 cockpit raffiné (owner: sizes too big) | `max-w-2xl`, 200px keypad tray, micro-ledger + gold NET band, 50px keys, two-step key scale | `PaymentModal.tsx`, `KeyPad.tsx` | ✅ lane: `modalW 672 · keyH 50 · cols 426px+200px` + vision PASS (keypad right, compact, no defects) |
| **Total** | **47 files** | **293** | **✅ 293/293, 0 fail · `tsc` clean · `lint` clean · `vite build` ✅** |

Live proofs (2026-11-02, real Edge lane via `playwright-core` + `msedge.exe`, see skill `pos-lane-proof`):
- v1.3.3 modal screenshot analyzed: payment cockpit confirmed, keypad visual-RIGHT, compact keys, totals hierarchy clean, zero defects.
- Lane archaeology: shared dev-server owner PIN is **5678** (lane #1 retired 1234); 5-strike lockout with 60s·2^cycles cooldown verified live; fresh profiles hit first-run store-setup overlay (name + NIF 15 + RC mandatory).
- Releases: `v1.3.2` + `v1.3.3` signed `SIG-OK [ED]` (keynum `489b702c66040e7e`), 3 assets each `uploaded` (`-setup.exe` + `.sig` + `latest.json`); auto-updater picks up v1.3.3.
- Iron status: v1.3.3 proven on web lane only — **silent-install + iron smoke still open** (every prior release had it).
- 2026-11-02 iron close-out: `BarakaMarket-1.3.3-setup.exe /S /D=D:\BarakaMarket-1.3.3`
  (must run via `cmd.exe` — MSYS bash mangles `/S /D=` args) → installed
  (`baraka-market.exe` + `uninstall.exe`); app launched with WebView2
  `--remote-debugging-port` → Playwright `connectOverCDP` lane: POS live,
  footer `V1.3.3`, payment modal `672×708` on iron, vision PASS (FR locale:
  keypad visual-LEFT = first-in-DOM, correct LTR mirror of the RTL right side;
  `NET 640 = 577.98 + 52.02 + 10`, `RENDU 0`, zero defects).

## Phase 5 — #003 SQLite invoke bridge + owner tasks (2026-11-02)
| Slice | Change | Result |
|---|---|---|
| Rust lane (`fiscal.rs` + `main.rs`) | `next_invoice` (atomic mint, UPDATE..RETURNING) · `void_sale` (status flip + journal, no DELETE) · `daily_z` (read-only) · `backup_db` (VACUUM INTO) + 4 invoke commands | ✅ `cargo fmt` clean · `cargo test` **18/18** (incl. 1000-mint gapless + void/journal + Z counts + reopenable snapshot) |
| TS routing (`fiscal-authority.ts`) | `commitVoid` / `backupDatabase` (invoke → loopback fallback) · `fetchDailyZ` (native-only) | ✅ lane order preserved: exe never downgrades to provisional |
| Permissions + UI | `sale.void` (manager+) · `AppContext.voidSale` · per-invoice void surface in Z view (reason mandatory, CANCELLED stays visible) | ✅ `commit-lane` +4 tests |
| One-shot migration | `scripts/migrate-localstorage.ts`: one-shot guard (`--force` to rebuild) · seq reseed to migrated maxima · golden-dump self-verify + `scripts/__fixtures__/localstorage-golden.json` | ✅ `migrate-golden` 2/2 (equality + refusal + force rebuild) |
| Single lane + parity | 1000 gapless mints · canonical vector `179400ct` (timbre `1800ct`) identical Rust↔TS · DRAFT refs never match fiscal pattern | ✅ `seq-lane` 3/3 |
| **Total** | | **✅ 302/302, 0 fail · `tsc` clean · `lint` clean · `vite build` ✅** |

Owner tasks (2026-11-02, all approved via clarify before implementation):
- **Auto-update dry-run** on `D:\BarakaMarket-1.3.3` (iron PIN 5678): `Sauvegarde & MAJ` → `Vérifier` → **`À jour — 1.3.3`**,
  footer `V1.3.3` + `REGISTRE FISCAL ACTIF (SQLITE WAL)`, vision PASS, zero defects. Nothing installed, no relaunch.
- **Reception inline new-product** (`SuppliersPurchasesView.tsx`): `+ منتج جديد` toggle → name + manual
  barcode (required, duplicate-rejected) + TVA (default 9%) + unit; prices reused from the line; creates via
  `addProduct` and inserts the receipt line at once (nav already gated `products.edit`).
  Lane proof: `SUCRE LANE 1KG` + `6139876543210` + `9%` + `PIECE`, vision PASS, zero defects.
- **Products DB read-only audit** (exe / loopback / UI): 14 products everywhere, 0 duplicate barcodes,
  0 negative prices/stock, 0 bad TVA, 0 null barcodes, 0 orphan purchase items.
  Observation (by design, no fix without approval): `product_barcodes` holds aliases only —
  primary barcodes live in `products.barcode`.
- Gates after the reception change: **302/302** · `tsc` clean · `build 1.52s` (iron app closed after smoke).

## Phase 6 — #004 legal day-lock (Z) (2026-11-02)
| Slice | Change | Result |
|---|---|---|
| Schema + migrate | `z_reports.close_kind` (`DAY` legal 1/day vs `SHIFT` session snapshot) · `LATEST_SCHEMA_VERSION 6` (TS + Rust, legacy climb) | ✅ version-pin tests bumped v5→v6 |
| TS ledger (`sqlite.ts`) | `isDayLocked` + `computeDayAggregates` (COMPLETED + ESPECES settlements) · `finalizeZReport` refuses 2nd DAY close + verifies 16 caller totals vs ledger · shift/sale/void refuse on locked day | ✅ `zclose.test.ts` 4/4 (settle→close→verify-chain, hash pinned vs `node:crypto`, reprint byte-identical via `buildZTicketText`) |
| Native lane (`fiscal.rs` + `main.rs`) | `z_close` (recompute + lock + chain in 1 Immediate tx) · sale/void day guards · `daily_z.closed` · `z_close` invoke cmd | ✅ `cargo test` **19/19** |
| TS lane (`fiscal-authority.ts`) | `commitZClose` (invoke → loopback, never fakes a lock) · `ZTicketData` canonical 80mm text | ✅ `commit-lane` +2 (fallback + native-only) |
| UI (`DailyZReportView.tsx`) | provisional `-P` fallback deleted · mount probe (`/api/z/list` DAY row = reprint source) + `fetchDailyZ.closed` · tickets render from the stored row (`tv.*`), live cards stay managerial · voids locked + close gated `z.close` (manager+) · FR plurals · `onClick={void handleClose()}` render-loop bug fixed · prev_hash display fixed (was own hash) · footer wraps <900px | ✅ lane: `Z-2026-000003 FINALISÉ`, lock banner, ticket reload `TICKET_EQUAL: true`, vision PASS 1366 + 768 |
| Live ledger proof | loopback restarted on new code (stale v5 process killed) · 2 sales + 1 ESPECES settlement + verified close (`71400ct`, chain genesis→`b47be2d4…`) · 2nd close → `400 already legally closed (Z FINALISÉ)` | ✅ day-lock enforced live, not cosmetic |
| **Total** | | **✅ 308/308, 0 fail · `tsc` clean · `lint` clean · `vite build` ✅** |

## Owner 2026-11-03 — manual lock + clean start + receipt edit/delete
- **Manual-only lock** (owner order): the 60s idle ticker deleted (it locked after
  15 min while seeing only fiscal commits — real shop activity never reset it) and the
  lock became an overlay (`z-[100]`) above the mounted tree instead of a takeover
  that unmounted the POS. Lane: cart `TOTAL TTC 660` before lock → `pinScreen+posAlive`
  → unlock `5678` → cart still `660` (PRESERVED). Security tradeoff (walked-away
  terminal stays open) explicitly accepted by owner.
- **«بداية نظيفة»** (`Settings > خطر`, owner + PIN + double confirm): wipes demo/
  operational localStorage (products/suppliers/clients/sales/purchases/settlements/
  payments/held/draft/outbox/barcodes/`baraka_seq_*`) + sets `CLEAN_START=1` so
  initializers start empty instead of reseeding demo; keeps users (SQLite), store
  identity, license, language, session; refused with pending outbox. Lane + vision PASS.
- **Receipt edit/delete** (manager+, `products.edit`): `deletePurchaseReceipt`
  (stock reversal with negative-stock refusal, PMP back-out, supplier debt floored
  at 0, BR number never reused) + `updatePurchaseReceipt` (reverse-old + apply-new,
  same invoice, debt delta). Pure math in `src/core/purchase-lane.ts` (6/6 tests).
  UI: تعديل/حذف on every receipt card; edit prefills the reception modal.
  Lane: `BR-2026-0002` created `+20` → edited to `+7` → deleted (gone), vision PASS.
- Gates: **314/314** · `tsc` clean · `lint` clean · `vite build` ✅.

## Release v1.3.4 — auto-update pushed & installed (2026-11-03)
- `tauri build --bundles nsis` → `Baraka Market_1.3.4_x64-setup.exe` (5.13 MiB);
  signed with the rsign key (empty password) → `.sig`; `verify-sig` → `SIG-OK [ED]`.
- `releases/latest.json` rewritten (v1.3.4 + ed25519 signature + installer URL);
  **platform-key fix**: `windows-x86_64` (the updater rejects `windows-x64` —
  proven by the iron's own `Échec: None of the fallback platforms ...` on first check).
- `gh release create v1.3.4` with 3 assets; CDN `latest/download/latest.json` serves v1.3.4.
- Iron `D:/BarakaMarket-1.3.3` dry-run → saw `1.3.4`; install recorded in the iron
  audit log (`update.install`, actor owner, 17:03 local) → binary + uninstaller
  timestamps renewed → footer `V1.3.4` · vision PASS (supplier cards, receipt
  `BR-2026-0089` with تعديل/حذف, no defects).
- Gates on the v1.3.4 tree: **314/314** · `tsc`/`lint` clean · `vite build` ✅.

## النقاط الثلاث — régime fiscal + Stock IO + Backup-Pro (2026-11-03)
- **Regime**: `fiscal_regime` per-sale (v7 TS+Rust + migrate + `regime_off` test);
  `Sale.fiscal_regime` + `DebtSettlement.timbre_enabled` → ticket/quittance footnote
  (ESC/POS `.bin` + DOM 80mm + quittance); Card 3 switches audited (`profile.change`).
  Lane5: `switches:2` ON, vision «no defect».
- **Stock IO**: `csv-exporter` (`;` + BOM + quoting) round-trips through `preflightCsv`
  (2/2); importer hardened (valid FR example, 5000-row cap, collision/unmapped counts,
  file picker, `stock.import/export` audit).
- **Backup-Pro**: sidecar manifest + `validate` fail-closed + retention 30 (test: 33→30,
  files+sidecars+rows pruned) + `GET /api/backups/file` (200/200, traversal 404);
  BackupManagerView rebuilt (stats + provenance + USB/manifest/restore + audit).
  Lane6 (API-seeded): rows render `v1.3.4 schema v7 [lane6b]` + 4 buttons, vision PASS;
  found+fixed: missing `x-baraka-loopback` on backup POSTs (graceful AR/FR message in
  browser lane) + bidi `4 / 30` and card-price `2 600` (`dir=ltr`).
- Gates: **327/327** · `tsc` clean · `lint` clean · `vite build` ✅ · `cargo test 20/20` ✅.

## Release v1.3.5 — النقاط الثلاث على الحديد (2026-11-03)
- Bump `1.3.4→1.3.5` (package.json + tauri.conf.json)؛ `tauri build --bundles nsis`
  → `Baraka Market_1.3.5_x64-setup.exe` (5.13 MiB, 8m58s + 8 snake_case warnings)؛
  التوقيع بنفس مفتاح rsign (فارغة) → `SIG-OK [ED]` (keynum `489b702c66040e7e`).
- `releases/latest.json` (v1.3.5 + `windows-x86_64`) → commit `45413dc` + tag `v1.3.5`
  + push؛ `gh release create v1.3.5` (exe + .sig + latest.json)؛ CDN يخدم v1.3.5.
- Iron: `Vérifier` (scoped للبطاقة بعد عطل أول نقر زر صف نسخة → 401) → عرض
  `Installer 1.3.5 + redémarrer` → تثبيت (`update.check/install 1.3.5` في تدقيق الحديد
  + `uninstall.exe` مجدد) → فوتر `V1.3.5` + سلة حية محسوبة صحيحاً — vision PASS.
