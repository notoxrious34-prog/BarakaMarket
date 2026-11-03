# CHANGELOG — Baraka Market

## v1.3.5 (2026-11-03) — النقاط الثلاث على الحديد
- **نفس بروتوكول v1.3.4**: bump رقمين → `tauri build --bundles nsis` (5.13 MiB)
  → توقيع rsign (فارغة) → `SIG-OK [ED]` → `latest.json` بـ `windows-x86_64`
  → `gh release create v1.3.5` (3 أصول) → CDN يخدم v1.3.5.
- **الحديد** (`D:/BarakaMarket-1.3.3`): رأى `Installer 1.3.5 + redémarrer` → ثبّت
  (تدقيق `update.install 1.3.5` + `uninstall.exe` مجدد) → فوتر `V1.3.5` + POS حي
  (سلة 6 أسطر، `1505.86+60.28+158.86+18=1743` ✓) — vision PASS بلا عيوب.
- يحمل: régime fiscal toggles + Stock CSV export + Backup-Pro (327/327).

## Unreleased — النقاط الثلاث (régime fiscal + Stock IO + Backup-Pro)
- **TVA/Timbre قابلان للتعطيل** (Card 3 «النظام الجبائي»): `tva_enabled=false` يصفر
  عند المصدر (HT=TTC حياً)؛ `timbre_enabled=false` يصفر حتى ESPECES؛ الأعلام تُخزن
  per-facture (`sales.tva_enabled/timbre_enabled`، ترقية v7 في TS+Rust) وتظهر على
  التذكرة/Quittance (`Régime forfaitaire — TVA non applicable`)؛ قلب أي مفتاح حدث
  `profile.change` مدقق. `fiscal.centimes 23/23` + `cargo 20/20`.
- **Stock IO**: مراجعة الاستيراد (مثال FR-canonical صحيح، حد 5000 سطر، عدّاد تصادم
  الباركود/الأقسام، زر ملف) + **تصدير CSV** (`;` + BOM + RFC-4180، أرقام DZD آمنة
  الفاصلة) مع round-trip test أخضر؛ تدقيق `stock.import/export`.
- **Backup-Pro**: manifest sidecar (app v + schema v + sha) يُكتب مع كل snapshot؛
  `list` تُغنيه؛ `validate` يفشل مغلقاً عند mismatch؛ احتفاظ **آخر 30** (ملف+sidecar
  +row)؛ `GET /api/backups/file` path-gated للـUSB؛ واجهة مُعاد بناؤها (إحصائيات
  + provenance + تحقق/تنزيل/manifest/استعادة بحجر) + تدقيق `backup.create/restore`؛
  إصلاح token-gating (التوكن يُرفق من الواجهة، رسالة عربية واضحة في المتصفح).
- إصلاحان بصريان من الـlane: سعر البطاقة `dir=ltr` (كان `600 2` بدل `2 600`) +
  عدّاد النسخ `dir=ltr`؛ lane5/6: switches:2 + CSV ⇄ + backup rows + stats PASS بصرياً.
- **327/327** · tsc/lint/build نظيفة.

## v1.3.4 (2026-11-03) — التحديث التلقائي مدفوع
- **التحديث التلقائي يعمل**: `latest.json` حي على GitHub (v1.3.4 + توقيع ed25519 +
  رابط المثبت)؛ الحديد `D:/BarakaMarket-1.3.3` رأى `1.3.4` وثبّته (تدقيق `update.install`
  في قاعدة الحديد + فوتر `V1.3.4` + ثنائية جديدة).
- إصلاح قناة التحديث: مفتاح المنصة الصحيح `windows-x86_64` (كان `windows-x64`
  فيرفضه المحدّث)؛ توقيع بمفتاح rsign (كلمة سر فارغة) + `verify-sig SIG-OK [ED]`.
- يحمل: قفل يدوي (overlay)، بداية نظيفة، تعديل/حذف وصولات المورد (314/314).

## Unreleased — طلبات المالك 2026-11-03 (قفل يدوي + بداية نظيفة + وصولات)
- قفل يدوي فقط (بأمر المالك): حذف عدّاد الخمول نهائياً (كان يقفل بعد 15 دقيقة
  دون رؤية أي نشاط غير مالي)؛ القفل أصبح overlay فوق المحل الحي — السلة (660 DZD
  قبل/بعد، lane) والمسودات تنجو. مقايضة أمنية مقبولة من المالك صراحة.
- «بداية نظيفة» في منطقة الخطر (مالك + PIN): مسح التجريبي (منتجات/موردين/عملاء/
  مشتريات/مبيعات/تسويات/عدادات) مع علامة CLEAN_START فلا تُعاد البذور؛ يُبقي
  المستخدمين والهوية والرخصة؛ مرفوض عند outbox معلق. Lane: الزر + PIN ظاهران، PASS بصري.
- وصل المورد (BR): حذف + تعديل كامل (مدير+) — عكس المخزون مع رفض السالب، عكس/إعادة
  PMP، دين المورد بالفرق، الرقم محفوظ. Lane: إنشاء 20 ← تعديل 7 ← حذف (اختفى)؛
  `purchase-lane.test.ts` 6/6؛ vision PASS.
- **314/314** · tsc/lint/build نظيفة.

## Unreleased — #004 legal day-lock (Z) (2026-11-02)
- `z_reports.close_kind` (`DAY` legal 1/day vs `SHIFT`); `LATEST_SCHEMA_VERSION 6`.
- `finalizeZReport` refuses 2nd DAY close + verifies 16 totals vs ledger; locked day refuses
  shift-close / new sales / voids (idempotent replays exempt).
- Rust `z_close` + `daily_z.closed`; TS `commitZClose` (invoke → loopback, never fakes a lock).
- Z view: no provisional `-P`; tickets reprint from the stored DAY row; voids locked; close gated
  `z.close`; fixed `onClick={void handleClose()}` render loop + prev_hash display.
- Lane: `Z-2026-000003 FINALISÉ` (714.00 DZD, genesis→`b47be2d4…`), 2nd close refused `400`,
  reload `TICKET_EQUAL: true`, vision PASS 1366 + 768. **308/308** · 19/19 Rust.

## Unreleased — #003 SQLite invoke bridge + owner tasks (2026-11-02)
- Rust: `next_invoice` / `void_sale` / `daily_z` / `backup_db` (+4 invoke commands); 18/18.
- TS: `commitVoid` / `backupDatabase` (invoke → loopback) + `fetchDailyZ` (native-only);
  `sale.void` (manager+) + per-invoice void surface in the Z view.
- Migration one-shot with golden-dump fixture, seq reseed, `--force` rebuild; 302/302.
- Owner tasks: auto-update dry-run PASS (`À jour — 1.3.3` on iron);
  inline new-product in the reception modal (manual barcode/TVA 9%/epicerie);
  products DB read-only audit clean (14/14/14, zero defects).

## v1.3.3 (2026-11-02) — cockpit raffiné
- Cash modal compacted per owner eye: `max-w-2xl`, 200px keypad tray RIGHT (first in RTL),
  micro-ledger + gold NET band, 50px keys, two-step `Key` scale (compact ~48px / comfort ~56px).
- Proven: real-Edge lane (`modalW 672 · keyH 50 · cols 426px+200px`) + vision PASS, no defects.
- 293/293 · tsc/lint/build clean · signed `SIG-OK [ED]` · release 3 assets `uploaded`.

## v1.3.2 (2026-11-02) — cash cockpit two-column
- Keypad moved RIGHT (248px, big keys) + tender column left; cash-only `max-w-3xl`.
- Lane COCKPIT 4/4. 293/293 · signed · released.

## v1.3.1 (2026-11-02) — KeyPad unification (owner note)
- Shared `Key`/`KeyPad` caps for payment + login PIN; role by text color only.

## BarakaKeygen v2 (2026-11-02, `releases/BarakaKeygen.exe`)
- Owner activation desk: generate → verify → history → quit + argv shortcut.
- Fixed v1 instant-exit (readline-after-close + Windows pipe line-drop) with a queue line-reader.
- Proven: `CHECK: VALID` + VERIFY VALID/INVALID + clean quit via piped stdin.

## v1.3.0 (2026-11-02) — Phase 3 C1-C5
- Touch keypad core, statement ledger, ceiling bars, expiry buckets, shortcuts registry + settings tab.
- 293/293 · signed · released · iron-smoked.

## v1.2.0 (2026-11-02) — Phase 2 cashier comfort
- Linguistic unification, daylight contrast 13/13 ≥4.5:1, direct cart qty, money guards, tabbed settings + NIF lock.
- 278/278 · signed · released · iron-smoked (POS live V1.2.0).

## v1.1.1 (2026-11-01) — Phase 1 trust + safety
- Outbox badge + inspector (retry / owner-gated discard), legacy boot, live `APP_VERSION`, timbre disclosure.
- Signed · silently installed + smoke + login E2E on iron.

## v1.0-rc1 (2026-10-26) — Session delivery
### Added
- `src/core/money.ts`, `fiscal.centimes.ts`: integer-centimes fiscal engine (TVA 0/9/19, timbre ESPECES-only, scale parser)
- `src/core/cart-bridge.ts`: drop-in UI bridge — AppContext money paths now compute in centimes
- `db/schema.sql` (15 tables, WAL, CHECK gates) + `src/db/sqlite.ts` (atomic sequencer, validated recordSale, void journal, VACUUM backup)
- `server/index.ts`: local API (health/products/sales/void/z-summary/backup) + live integration tests
- `scripts/`: seed-db, migrate-localstorage, bench-core, READMEs; `npm run test:all/api/seed/migrate/bench`
- Docs: PLAN_DIRECTEUR_v1.0, TEST-REPORT, DELIVERY, TAURI-PLAN
### Fixed
- Vite native-config `__dirname` warning → `import.meta.dirname`
- tsc errors in migrate script (typed legacy DTOs)
### Verified
- 33/33 tests green · tsc EXIT 0 · vite build success · bench PASS · migration dry-run 0-drift
