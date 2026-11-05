# تقرير الجلسة — من v1.4.4 إلى v1.4.9 (2026-11-05)

> الوثيقة المرجعية لجلسة العمل الكاملة: من بلاغات المالك الثلاثة على v1.4.4
> إلى المثبت الجامع v1.4.9. كل رقم أدناه مثبت بأداة (بوابة، سجل بناء، قاعدة
> حديدية، أو أصل منشور) — لا استنتاجات بلا دليل.

## 0. الخلاصة التنفيذية

| النسخة | الاسم الحركي | البوابات | النشر | الإثبات الحديدي |
|---|---|---|---|---|
| v1.4.5 | مجمّع التدقيق المؤسسي | `tsc` + `test:all 386/386` + `cargo 25/25` | tag + 3 أصول + CDN `1.4.5` | ترقية `1.4.4→1.4.5` (`user_version=8` + صف `update.install`) |
| v1.4.6 | #PROD-CASH (الاستقلال الإنتاجي) | `tsc` + `test:all 386/386` + `cargo 26/26` | tag (مصحح على `3ca46cd`) + 3 أصول | جلسة `PROD/500000/OPEN` حية بلا `:3100` |
| v1.4.7 | #PROD-FAIL (منع الفشل الصامت + تثبيت نظيف) | `tsc` + `test:all 388/388` + `cargo 27/27` + `sale-outbox 12/12` | tag + 3 أصول | A/B البذور (`0/0/0/0` مقابل `14/4/5/1`) + سطر `⚠ FOREIGN KEY` حي |
| v1.4.8 | #PROD-SALE (إصلاح فخ العميل الشبح) | `tsc` + `test:all 389/389` + `cargo prodsale` | tag + 3 أصول | بيعتان عالقتان صُرفتا (`FACT-000001/000002`) + بيع جديد (`FACT-000003`) والطابور `0` |
| v1.4.9 | #PROD-LOCAL (المسارات الأخيرة أصلياً) | `tsc` + `test:all 389/389` + `cargo prodlocal 2/2` | tag + 3 أصول + `RELEASE-GATE PASS` + CDN `1.4.9` | `backup_create` مُتحقق + رفض خسارة مسمى + `z_list` + عذرية `0/0` مزدوجة |

- **المثبت الجامع (النسخة التي تذهب للمحلات):** `releases/BarakaMarket-1.4.9-x64-setup.exe` (5,181,981 بايت) + `.sig` + نشرة https://github.com/notoxrious34-prog/BarakaMarket/releases/tag/v1.4.9
- **حالة الشجرة وقت التوثيق:** `main` عند `dc209fb` (عمل متزامن خارج نطاق هذا التقرير، غير مدفوع — انظر §13)، والوسوم `v1.4.5→v1.4.9` مدفوعة. كود v1.4.9 نفسه عند `b57002e` مدفوع بالكامل.
- **رقم الدعم المعتمد في كل الواجهات:** `+213 770 80 70 05`.

## 1. نقطة البداية وبلاغات المالك (v1.4.4)

البلاغات الثلاثة الحرفية من المالك على v1.4.4:

1. **«البيع لا يتم ولا يدخل في الحسابات»** — بيعتان عالقتان في الطابور الصادر (`SALE-1793883159074` و`SALE-1793883275215`) بلا سبب ظاهر.
2. **«البرنامج عند تنصيبه أول مرة يأتي بمخزون وموردين وديون وكأنه تجريبي»** — تثبيت جديد يعرض كتالوج `14/4/5/1`.
3. **«تأكد من حزم البرنامج كاملا»** — شاشة `Caisse & Clôture` تعرض `Mode autonome: sessions live indisponibles` على المثبت.

التشخيصات الجذرية المثبتة لاحقاً (بالترتيب): (3) `fetch(http://127.0.0.1:3100/...)` بلا خادم في المثبت؛ (1) `FOREIGN KEY constraint failed` أصلي على `client_id: 1` الشبح (يعمل في التطوير لأن قاعدتها تحوي العملاء)؛ (2) بذور `initialProducts/Clients/Suppliers/Purchases` بلا بوابة تمييز مثبت/متصفح — مع تلوث إضافي من مخزن WebView المشترك (انظر §10).

## 2. v1.4.5 — مجمّع التدقيق المؤسسي (التأسيس)

**الهدف:** تجميع كل إصلاحات التدقيق المؤسسي في نسخة واحدة تراكمية قبل أي عمل إنتاجي.

- **F2 — اليوم القانوني:** `src/core/fiscal-day.ts` + `fiscal-day.test.ts` (4/4). اليوم = Africa/Algiers المحلي في TS **و** Rust (بلا `chrono`: `days_from_civil/civil_from_days/algiers_day/day_bounds_utc`)، نفس النافذة `[D-1 23:00Z, D 23:00Z)`. اختبار الحافة `00:30` محلياً + `f2_edge` أصلياً.
- **الربط البيني X1:** `DRAFT`/`is_provisional` مستبعدة من كل الدفاتر (`compta-kernel` + `accounting` + `generateDailyZReport` + `DailyZReportView`) — `compta-kernel.test` (6/6).
- **الترخيص L1:** `assessStoredLicense` (تحقق Ed25519 على `STORE||HWID` عند الإقلاع) + `licenseBroken/licenseDrift/licenseCryptoOk` + لافتات مرفوض/منحرف + تذييل `Ed25519 hors-ligne`.
- **الإغلاق K9:** `listCashSessions` + `GET /api/cash/sessions` + سجل F8 + `confirm()`.
- **التقارير السابقة:** `QA-*-AUDIT.md` لكل من caisse/stock/suppliers/dettes/compta/Z/clôture/licence/cross.
- **البوابات:** `tsc` + `test:all 386/386` + `lint` + `cargo 25/25` → commit `2c7adae` + Rust F2 `3efb00a` → `BUILD_EXIT:0` → توقيع → `releases/` + `latest.json` → tag + نشرة 3 أصول → `verify-release` → CDN `1.4.5`.
- **الإثبات الحديدي:** تنصيب `1.4.4` ثم ترقية فوقية `1.4.5`: `user_version=8` + `tables=25` + صف `1.4.4 → 1.4.5 (upgraded, silent/boot-detected)` عبر ختم `baraka_last_seen_version_v1=1.4.4`.
- **التقرير التاريخي:** `docs/DEVELOPMENT-REPORT-v1.0.0-to-v1.4.5.md` (117 commit، 338 ملفاً، `+38612/-1559`، 64 ملف اختبار).

## 3. v1.4.6 — #PROD-CASH (الاستقلال الإنتاجي)

**السبب:** `CashSessionsView` كانت `fetch(:3100)` خالصاً — ميتة في المثبت.

- **Rust (`src-tauri/src/fiscal.rs`):** مسار نقدي أصلي كامل `cash_open/cash_movement/cash_active/cash_sessions/cash_movements/cash_close_and_z` (جداول via `ensure_cash_tables`، `now_iso`، Z مسلسل) + اختبار `cash_lane` (نظرية `105000 = 5000 + 100000`).
- **التسجيل (`main.rs`):** 6 أوامر + `generate_handler`.
- **`fiscal-authority.ts`:** أنواع `Cash*DTO` + مساعدات `cash*Native` (أصلي-أولاً، loopback ثانياً) + `cashLoopback` تُرجع `null` فوراً في `isTauriRuntime()`.
- **الواجهة:** `refresh/post` أصلي-أولاً + `laneAlive = Array.isArray(rows)` + إعادة محاولة مؤجلة واحدة لسباق أول `invoke` بعد إقلاع WebView (تقتل وميض `Mode autonome` الكاذب).
- **`AppContext.postTillExpense`:** أصلي-أولاً + حدث تدقيق `till.expense`.
- **البوابات:** `test:all 386/386` + `cargo 26/26` → `d588cbd` → بناء (`Finished 1 bundle` + `BUILD_EXIT:1` = مفتاح التوقيع غائب من البيئة فقط، §7) → توقيع يدوي `SIG-OK [ED] keynum=489b702c66040e7e` → tag (صُحح لاحقاً على `3ca46cd` بعد إصلاح الوميض) → `gh release` (ثُبتت `gh` عبر `WindowsApps/winget.exe`) → `RELEASE-GATE PASS`.
- **الإثبات الحديدي:** قتل `:3100` عمداً (`NO-3100-LISTENER`) + تثبيت نظيف + جلسة `PROD/500000/OPEN` حية + `autonome:false, live:true`.

## 4. v1.4.7 — #PROD-FAIL (منع الفشل الصامت + تثبيت نظيف)

**السبب (من صور المالك على v1.4.6):** طابور بلا سبب + كتالوج في تثبيت جديد. الجذران: `catch { auth = null }` يبتلع الرفض؛ زر Z بلا تأكيد؛ بذور بلا بوابة.

- **لا صمت:** `lastLaneError()` (يلتقط سبب كل رفض native/loopback + نص HTTP) + حقل `lastError` على سطر الطابور (يبقى بعد reload) + عرض `⚠ سبب الرفض` في `App.tsx` + أول رفض يُختم في الطابور.
- **الإغلاق اليومي مقفل:** `handleClose` يطلب تأكيداً صريحاً (تاريخ + لارجعة + تجميد البيع + إرشاد Clôture أولاً).
- **`demoSeedAllowed() = !isTauriRuntime() && !isCleanStart()`:** المثبت يبدأ فارغاً (مشتريات فارغة أيضاً). الإثبات A/B: ملف عذراء stubbed = `0/0/0/0` مقابل متصفح = `14/4/5/1`.
- **البوابات:** `test:all 388/388` + `cargo 27/27` + `sale-outbox 12/12` → `0e7eac4` → بناء/توقيع/`RELEASE-GATE PASS` → نشرة v1.4.7.
- **الإثبات الحديدي:** ملف نظيف: `products=14 sales=0 sessions=PROD:OPEN` + **السطر الذي كشف كل شيء:** `⚠ [fiscal] FOREIGN KEY constraint failed` على بيع عابر `client_id: 1` — الجسر إلى v1.4.8.

## 5. v1.4.8 — #PROD-SALE (إصلاح فخ العميل الشبح)

**السبب الجذري (مثبت حياً على v1.4.7):** كل بيع عابر يحمل `client_id: 1` لزبون غير موجود في `clients` الفارغة كان يموت بـ`FOREIGN KEY` **أصلياً**. يعمل في التطوير (عملاء موجودون) ويموت في المثبت — لهذا «كان يعمل فقط في بيئة التطوير».

- **الإصلاح (توأم TS/Rust):** العميل المجهول ⇒ `NULL` عابر للنقد (الاسم محفوظ في السطر)؛ `CREDIT` لمجهول ⇒ رفض مسمى `client inconnu`. المنتج الشبح كان محمياً أصلاً (NULL).
- **الاختبارات:** `prodsale_unknown_client_cash_walks_in_credit_refused` (Rust) + `db: PROD-SALE unknown client` (TS) → `test:all 389/389`.
- **البناء/النشر:** bump `1.4.8` + CHANGELOG → بناء (`Finished 1 bundle`/`BUILD_EXIT:1` §7) → توقيع `SIG-OK` → `releases/` + `latest.json (sig_len=424)` → tag + نشرة → `RELEASE-GATE PASS: v1.4.8`.
- **الإثبات الحديدي (الأهم في الجلسة):** على المثبت الحقيقي، عند الإقلاع صُرفت البيعتان العالقتان **بالذات** تلقائياً بالمسار المُصلح:
  - `FACT-2026-000001` / `T-2026-000001` — عميل `NULL` (الاسم محفوظ) — `66000ct` — COMPLETED
  - `FACT-2026-000002` / `T-2026-000002` — عميل `NULL` — `19000ct` — COMPLETED
  - ترقيم متسلسل بلا فجوات (مفتاح عدم التكرار صمد عبر 6 محاولات فاشلة سابقة)
  - ثم بيع جديد حي (مسح `LAIT` → سلة → دفع نقدي → تذكرة) ⇒ `FACT-2026-000003` + المخزون نقص + **الطابور `0`** + لا `Mode autonome`.

## 6. v1.4.9 — #PROD-LOCAL (المسارات الأخيرة أصلياً)

**السبب:** مسح شامل لكل `fetch(:3100)` وجد ثلاثة مسارات تموت في المثبت: (1) النسخ الساخن — الزر يفشل بـ`Failed to fetch` رغم وجود أمر `backup_db` الأصلي الذي لا يناديه أحد؛ (2) خسائر المخزون — تبقى محلية ولا تصل القاعدة الجبائية في الإنتاج؛ (3) سجل Z — لا إعادة طباعة ولا سلسلة بعد إعادة التشغيل.

- **Rust (`fiscal.rs` + `main.rs`):** أربعة أوامر جديدة مسجلة في `generate_handler`:
  - `record_loss` — دفتر + خصم ذري + رفض مسمى (شبح/زائد/سبب سيئ)؛ اختبار `prodlocal_loss_ok_and_refusals`.
  - `backup_create` — الوجهة مشتقة من مجلد القاعدة (`…/backups/baraka-YYYYMMDD-HHMMSS[-label][-n].db`) + `VACUUM INTO` + بوابة سلامة على اللقطة + `register_backup` + تقليم احتفاظ (الأحدث 30 غير-معفاة).
  - `backup_list` — `backups_log` تنازلياً (نفس شكل `BackupRow`).
  - `z_list` — سجل `z_reports` + رأس السلسلة (`GENESIS` عند الفراغ).
  - اختبار `prodlocal_backup_and_z_registry` — `cargo prodlocal 2/2`.
- **المسارات (`fiscal-authority.ts`):** `recordLossNative/backupCreateNative/backupListNative/zListNative` + توسيع union `invokeLane`.
- **الواجهات (أصلي-أولاً، loopback ثانياً):**
  - `ProductToolModals` — الخسارة أصلياً ثم loopback ثم محلي (دون ازدواج).
  - `BackupManagerView` — قائمة وإنشاء أصلياً؛ الاستعادة/التنزيل عبر HTTP تبقى loopback حصراً، وفي المسار الأصلي يُعرض مسار الملف الدقيق + توجيه صادق (الاستعادة = إغلاق التطبيق ونسخ الملف فوق `baraka.db` يدوياً — القاعدة الحية مقفلة).
  - `DailyZReportView` — `zListNative` أولاً (إعادة طباعة + سلسلة بعد إعادة التشغيل)؛ `:3100` يبقى بديل تطوير.
- **البوابات:** `tsc` + `test:all 389/389` + `lint` + `cargo prodlocal 2/2` → commit `b57002e` مدفوع → بناء/توقيع/`RELEASE-GATE PASS: v1.4.9` → CDN `1.4.9 (sig_len=424)`.
- **الإثبات الحديدي (§8):** أوامر حية على مثبت حقيقي + تجربة العذرية المزدوجة (§10).

## 7. هندسة الإصدار — الإجراء القابل لإعادة التنفيذ

1. **المتطلبات:** القرص `C` ممتلئ — كل شيء على `D`: `CARGO_HOME=D:/cargo-home`، `CARGO_TARGET_DIR=D:/cargo-target`، كاش npm على `D`، سجلات البناء في `scratch/*.log`. لا يُدعى أي إنجاز قبل قراءة `BUILD_EXIT`/`SIG-OK`/`RELEASE-GATE`.
2. **البناء:** `npx tauri build --bundles nsis` (خلفية، السجل `scratch/build14x.log`). `BUILD_EXIT:1` رغم `Finished 1 bundle` **طبيعي ومتوقع**: سببه الوحيد غياب `TAURI_SIGNING_PRIVATE_KEY` من البيئة (المفتاح العام موجود في `tauri.conf`) — الحزمة `.exe` صالحة وكاملة.
3. **التوقيع اليدوي:** `npx tauri signer sign "<exe>" -f D:/Downloads/baraka-updater.key` ثم `node scripts/verify-sig.mjs <exe> <sig> <pub>` ⇒ `SIG-OK [ED] keynum=489b702c66040e7e` (+ `SIG_EXIT:0`). المفتاح العام يُستخرج من `tauri.conf (plugins.updater.pubkey)` إلى `scratch/baraka-updater.key.pub` عند الحاجة.
4. **التجميع:** نسخ `exe+.sig` إلى `releases/BarakaMarket-X.Y.Z-x64-setup.exe(.sig)` + توليد `releases/latest.json` (التوقيع `sig_len=424`). **`releases/` مُتجاهل gitياً** — الثنائيات لا تُcommit؛ تُرفع لأصول النشرة فقط.
5. **النشر:** `git tag vX.Y.Z` + `gh release create vX.Y.Z <الأصول الثلاثة>` (ثُبتت `gh` عبر `WindowsApps/winget.exe`؛ الدخول `notoxrious34-prog` keyring) → `node scripts/verify-release.mjs vX.Y.Z` ⇒ `RELEASE-GATE PASS` → فحص CDN (`.../releases/latest/download/latest.json`).
6. **تصحيح الوسم عند الحاجة:** حذف محلي + `git push origin :refs/tags/<t>` + إعادة الوسم والدفع (سابقة: v1.4.6 على `3ca46cd`).

## 8. سجل الإثباتات الحديدية (ملخص تراكمي)

| # | الهدف | الجهاز/الملف | الدليل |
|---|---|---|---|
| 1 | ترقية `1.4.4→1.4.5` | `D:/Test144` | `user_version=8` + `tables=25` + صف `1.4.4 → 1.4.5 (upgraded, silent/boot-detected)` عبر ختم `baraka_last_seen_version_v1` |
| 2 | استقلال Clôture | `D:/Test146` (`:3100` مقتول) | `PROD-OPEN` حية + `autonome:false, live:true` + `PROD/500000/OPEN` في القاعدة |
| 3 | بوابة البذور A/B | ملفات عذراء | stubbed(Tauri) `0/0/0/0` مقابل متصفح `14/4/5/1` |
| 4 | كشف سبب الرفض | `D:/Test147` | `⚠ [fiscal] FOREIGN KEY constraint failed` حي على `client_id: 1` |
| 5 | صرف الطابور + بيع جديد | `D:/Test148` | `FACT-000001` (66000) + `FACT-000002` (19000) + `FACT-000003` (بيع LAIT حي) + طابور `0` + مخزون منقوص |
| 6 | نسخ أصلي حي | `D:/Test149c` + exe `D:/Test148` | `backup_create` ⇒ `VERIFIED` + `sha256:3b45931a…` + `schema v8` + `appVersion 1.4.9` ⇒ مقروءة عبر `backup_list` |
| 7 | رفض خسارة مسمى | نفس الجهاز | `record_loss(99999)` ⇒ `[fiscal] loss target product not found: 99999` |
| 8 | سجل Z أصلي | نفس الجهاز | `z_list` ⇒ `{rows: [], prev_hash: GENESIS}` على قاعدة عذراء |
| 9 | عذرية مزدوجة | `Test149cdata` + `EBWebView` جديد | منتجات `0` + زبائن `0` (أصلياً وواجهة) — §10 |

أدوات القيادة: Edge عبر CDP (منفذ يُمرر بـ`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9xxx` — §9)، سواقات `qa/qa*.js` خارج المستودع (`scratch/qa`)، قراءة القاعدة بـ`node:sqlite` (`DatabaseSync` للقراءة فقط).

## 9. حقائق البيئة المكتشفة (ملزمة للجلسات القادمة)

1. **القرص `C` ممتلئ 100%:** كل الكاش والبناء والـTMP على `D` حصراً (`CARGO_HOME`/`CARGO_TARGET_DIR`، كاش npm، سجلات `scratch/`).
2. **MSYS2 يُحوّل المسارات:** تمرير `/D=D:\…` أو أعلام `.exe` يتطلب `MSYS2_ARG_CONV_EXCL="*"` — بدونه يُشوَّه `/D` ويتجاهل المثبت الوجهة.
3. **مثبت NSIS يتذكر آخر مجلد من السجل:** إعادة التنصيب بوجهة جديدة تُتجاهل لصالح المجلد المسجل — **أزل التثبيت السابق أولاً** (`Uninstall.exe /S`) قبل تغيير الوجهة.
4. **CDP على WebView2:** متغير البيئة `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=PORT` هو الطريق الموثوق؛ تمرير العلم مباشرة للـexe غير موثوق.
5. **انشطار الملفات:** `APPDATA` المُتجاوَز يعزل **القاعدة الأصلية فقط**؛ مخزن WebView (ومنها `localStorage`) يعيش في `%LOCALAPPDATA%\com.barakamarket.pos\EBWebView` على مستوى الجهاز ويُشارك بين كل النسخ — أي تجاوز جزئي يُباعد القاعدة والواجهة (قطعة اختبار فقط؛ في الإنتاج متطابقان دوماً).
6. **كشف Tauri:** `isTauriRuntime() = '__TAURI_INTERNALS__' in window || '__TAURI__' in window` (الثاني غائب عند `withGlobalTauri: false` — طبيعي).
7. **لا تخمين رموز:** PIN مالك التطوير تغيّر (`owner/1234` أعاد `NOK` على `:3000`) — توقف الاحترام الأمني؛ التحقق عبر `localStorage`/الأصلي. جلسة الدخول الحديدية بانتظار إغلاق المحل.
8. **`gh` وWinget:** `gh` غائب افتراضياً — التثبيت عبر `WindowsApps/winget.exe install GitHub.cli`.

## 10. تجربة تبرئة بوابة البذور (الأهم منهجياً)

**الشبهة:** ملف جديد + مثبت حقيقي أظهر 14 منتجاً رغم `demoSeedAllowed()` — هل البوابة مخترقة في المثبت؟

**التجربة الحاسمة (عذرية مزدوجة):** قُتل المثبت، نُسخ `EBWebView` احتياطياً (73MB إلى `scratch/EBWebView-backup-1.4.9`)، حُذف الأصلي، أُنشئ `D:/Test149cdata` جديد، أُقلع المثبت:
- **النتيجة:** منتجات `0` + زبائن `0` + موردون `0` + مشتريات `0` (واجهة وقاعدة) — **البوابة سليمة.**
- **الجذر الحقيقي:** `localStorage` موروثة من تشغيلات سابقة في الملف المشترك (§9.5)، زُرعت قبل البوابة (عصر v1.4.6) ثم انعكست أصلياً عبر `syncCatalogToNative`.
- **الترميم:** أُعيد `EBWebView` الأصلي من النسخة الاحتياطية (حالة الجهاز صفر-أثر)، وحُذفت كل مجلدات الاختبار.

## 11. القرارات المقفلة

- F2: اليوم القانوني = Africa/Algiers المحلي (TS+Rust، `[D-1 23:00Z, D 23:00Z)`).
- قفل الانجراف: مفتاح سليم على `hwid` مختلف ⇒ قفل POS حتى إعادة التفعيل؛ القديم بلا hwid ⇒ ثقة موروثة (تحذير).
- Stock S1 دفعي ذري + `product_delete` يحترم RESTRICT؛ M1 عدّاد BR رتيب مزروع؛ M4 رفض الزائد؛ M7 NIF=15 رقماً؛ D1 حراس التسديد؛ D3 عكس إلغاء CREDIT؛ X1 استبعاد `DRAFT` من كل الدفاتر.
- #PROD-CASH: أصلي-أولاً، `offline` فقط عند غياب المسارين.
- #PROD-FAIL: لا صمت (`lastLaneError/lastError/⚠`)؛ إغلاق Z بتأكيد صريح؛ `demoSeedAllowed()`.
- #PROD-SALE: مجهول النقد ⇒ `NULL` عابر؛ مجهول الآجل ⇒ رفض مسمى.
- #PROD-LOCAL: الاستعادة/التنزيل عبر HTTP تبقى loopback؛ الاستعادة الأصلية يدوية بتوجيه صادق.
- العتاد (HAL/طابعة/درج) **معلق** بقرار المالك — لا تنفيذ عتاد في v1.4.5→v1.4.9.

## 12. بقايا صادقة ومخاطر معلنة (لا تُقرأ كعيوب مسكوت عنها)

1. **لقطة حوار تأكيد الإغلاق اليومي بصرياً** لم تُلتقط (تتطلب دخولاً حديدياً) — الكود مبرهن بالمراجعة والـdiff فقط.
2. **الاستعادة في المثبت يدوية** (نسخ ملف فوق `baraka.db` والتطبيق مغلق) — قيد معلن في الواجهة نفسها؛ الاستعادة الساخنة تتطلب خادم التطوير.
3. **`spoolRawBytes` (print-lane) بلا منادين** — مسار ميت، الطباعة الفعلية عبر `window.print`/التذكرة؛ يُحسم في نسخة لاحقة (حذف أو تفعيل).
4. **تحذيرات `cargo` الاسمية** (`userId`/`oldPin` بدل snake_case) — تجميلية، تُطبَّع مع `cargo fmt/fix` القادم.
5. **`qa/` خارج المستودع** (`scratch/qa`) — سواقات الاختبار الحديدية ليست جزءاً من الشجرة (قرار نظافة متعمد).
6. **عمل متزامن وقت التوثيق:** `dc209fb feat(users) T8b` فوق `b57002e` (غير مدفوع) + وسم `v2.0.0-mkt` — خارج نطاق هذا التقرير.

## 13. خريطة الملفات والالتزامات

**ملفات v1.4.9 (commit `b57002e`):**
- `src-tauri/src/fiscal.rs` — `record_loss/backup_create/backup_list/z_list` + اختبارات `prodlocal_*`.
- `src-tauri/src/main.rs` — 4 أوامر + `generate_handler`.
- `src/core/fiscal-authority.ts` — 4 مسارات + توسيع union.
- `src/components/Inventory/ProductToolModals.tsx` — خسارة أصلي-أولاً.
- `src/components/Reports/DailyZReportView.tsx` — سجل Z أصلي-أولاً (+ تأكيد الإغلاق من v1.4.7).
- `src/components/Settings/BackupManagerView.tsx` — نسخ أصلي-أولاً + بوابة المسار + `createNow`.
- `src/context/AppContext.tsx` — (v1.4.6→v1.4.8) `postTillExpense` أصلي + `demoSeedAllowed` + `replayOutbox` المسمى + فلاتر X1/F2.
- `src/core/sale-outbox.ts` — `lastError` (v1.4.7)؛ `src/db/sqlite.ts` — توأم walk-in + `listCashSessions/Movements` + نوافذ F2؛ `server/index.ts` — `/sessions` + `/movements` + `/z/summary`؛ `CHANGELOG.md` — أقسام v1.4.5→v1.4.9.

**الالتزامات والوسوم:** `2c7adae`(v1.4.5) → `3efb00a`(Rust F2) → `d588cbd/844f142/3ca46cd`(v1.4.6) → `0e7eac4`(v1.4.7) → `7a217aa`(v1.4.8) + `11e79a1`(توثيق) → `b57002e`(v1.4.9)؛ الوسوم `v1.4.5…v1.4.9` مدفوعة؛ النشرات الخمس حيّة (exe + sig + latest.json لكل منها).

## 14. الدروس الإجرائية (للجلسات القادمة)

1. **ابنِ ثم برهن ثم انشر:** لا ادعاء قبل `BUILD_EXIT`/`SIG-OK`/`RELEASE-GATE`؛ البناء الطويل في الخلفية إلى `scratch/*.log` مع إشعار.
2. **الحديد يحكم:** أي «يعمل في التطوير» يُعاد إثباته على مثبت نظيف بملف معزول — فخ العميل الشبح كان سيبقى مخفياً لولا ذلك.
3. **اعزل الواجهة والقاعدة معاً:** أي تجربة عذرية على المثبت تتطلب حذف `EBWebView` الجهازي **بعد نسخه احتياطياً واستعادته** — وإلا فالاستنتاج ملوث.
4. **لا صمت أبداً:** كل مسار يجيب `null` يجب أن يترك سبباً (`lastLaneError`/`lastError`/رسالة واجهة) — القاعدة التي كشفت فخ v1.4.8.
5. **التوأمة TS/Rust:** أي قاعدة جبائية في مسار تُكتب في الاثنين مع اختبارين متوازيين (تقليد `PROD-SALE`/`PROD-LOCAL`).
6. **وثّق أثناء العمل لا بعده:** CHANGELOG يُكتب مع الـbump، وتقرير الجلسة يُبنى من سجلات الأدوات لا من الذاكرة.
