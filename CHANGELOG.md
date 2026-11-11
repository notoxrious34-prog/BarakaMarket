# CHANGELOG — Baraka Market

## v1.8.0 (2026-11-11) — خمسة المكاتب Desk + تدقيق ما قبل النشر MKT-012

**السياق**: بعد v1.7.0، أُعيد تصميم الوحدات الخمس بنظام Desk موحد
(بطل + خطوات مرقمة + Master/Detail + شريط صحة + نوى خالصة)، ثم أُصلحت
عيوب التمرير الحقيقية، ثم نُفذت قائمة الاعتماد البصرية (ليلي/نهاري/UHD):
- **MKT-006 — Retours**: ثلاث جزر (`Lookup/Drafts/Claims`) + نواة `returns-health`.
- **MKT-007 — Ventes**: ثلاث جزر (`Health/List/Detail`) + `sales-book-detail` + `useAsyncResource`.
- **MKT-008 — Compta**: نواة `TillOutcome` (ثلاثية lane-down الصادقة).
- **MKT-009 — Z**: `ZPrintPreview` + منتقي أيام + `z-dayrow` (ضد NaN).
- **MKT-010 — Clôture**: `CloseSummary/CashCount` + `cash-snapshot` + `use-async`.
- **MKT-011 — إصلاح Ventes الحقيقي**: الجذر يملك تمريره (TDD: فشل قبل، نجح بعد).
- **ADR-045 — Retours Desk**: شبكة Master/Detail + رصيف قرار + اختيار تلقائي.
- **MKT-012 — قائمة الاعتماد**: الجزر الفاتحة ميتة (L1–L4 + CTA الدافئ)،
  تباين AA (خافت `#7d8da6`، تعبئات 700)، كثافة UHD حتمية (3840 → 10 أعمدة).
- رسالة التحديث الودية (FR/AR) + إصلاح الطيّة في الرخصة.
- **البوابات**: `tsc` + `473/473` + `cargo 42/42` (صفر warnings) + `lint` + `build` نظيفة.

## v1.7.0 (2026-11-10) — خارطة التميز Apex: عزل السلة + قفل الهندسة + عزل الساعة + تقسيم POS + أول submodule أصلي

**السياق**: ترقية الحوكمة إلى `CONSTITUTION v4.0-APEX-MKT` (TASK-GOV-MKT-APEX-001)
ثم خمس مهام أداء/معمارية متتالية، كل واحدة بإثبات حي وبوابات كاملة:
- **MKT-001 — عزل السلة**: `CartContext` مذكّر منفصل عن `AppContext`؛ زمن
  المسح `median 225ms ← 30ms` (مسبار حي 10 مسحات قبل/بعد).
- **MKT-002 — قفل الهندسة**: الجذر `h-dvh overflow-hidden` + `min-h-0` +
  الواجهات `100dvh`؛ إثبات `1024×650` داكن + فاتح: تمرير الصفحة 0.
- **MKT-003 — عزل الساعة**: `NavbarClock` مذكّرة بفاصلها الخاص (الشريط لم
  يعد يُعاد render كل ثانية) + تنسيق خالص مُختبر.
- **MKT-004 — تقسيم POS**: `PosView` ‏746←534‏ سطرًا (4 جزر `memo`:
  بطاقة/سطر/مجمعات/اختصارات)؛ مسح + stepper + F3 (‏-10%، ‏1021←955) +
  الدفع كلها خضراء حيًا.
- **MKT-005 — أول submodule أصلي**: دفتر المبيعات خارج `fiscal.rs`
  (‏5121←4970‏) إلى `fiscal_sales_book.rs` باختبار عقد ذاتي؛ إعادة تصدير
  تُبقي كل مواقع الاستدعاء untouched.
- **البوابات**: `tsc` + `449/449` + `cargo 42/42` (صفر warnings) + `lint` +
  `build` نظيفة.

## v1.6.0 (2026-11-10) — دفتر المبيعات master/detail (بطلب المالك)

**السياق** (ملاحظة المالك بالصورة): تفاصيل الوصل كانت أسفل الصفحة — مع يوم
مزدحم يلزم النزول لآخر الصفحة عند كل وصل. الفكرة من Baraka UltraPOS: قائمة
ولوحة تفاصيل جنبًا إلى جنب.
- **التصميم الجديد**: شبكة `قائمة | لوح جانبي` — القائمة بتمرير داخلي
  (`62vh`) واللوحة `sticky` لا تغادر الشاشة أبدًا؛ الصف المحدد بإطار أخضر
  ويُسحَب لمرأى القائمة (تمرير القائمة فقط — الصفحة لا تتحرك)، وأول
  (الأحدث) وصل يُفتح تلقائيًا. عمود `أسطر/Articles` جديد عبر
  `item_count` (TS + أصلي + اختبارات).
- **الإثبات الحي**: 19 وصلًا — اختيار الأول/الأوسط/الأخير: التطابق
  (الصف = اللوحة) ✓ واللوحة في الشاشة ✓ وتمرير الصفحة 0 ✓ — داكن + فاتح
  بلا أخطاء.
- **البوابات**: `tsc` + `437/437` + `cargo 41/41` + `lint` نظيفة.
- سلوك Duplicata والفلاتر والصحة والتصدير بلا أي تغيير.

## v1.5.3 (2026-11-10) — القناة الأصلية لدفتر المبيعات (إصلاح حرج)

**السياق** (تقرير ميداني بالصورة): النسخة المثبتة v1.5.2 تعرض `lane unreachable`
في تبويب المبيعات. السبب الجذري: دفتر المبيعات كان يقرأ عبر خادم loopback
(`127.0.0.1:3100`) الذي لا يعمل داخل الصندوق المثبت — نفس عيب T12 حرفيًا
(الـ exe لم يمتلك هذه القناة أبدًا).
- **الحل**: ثلاث أوامر أصلية `sales_book_day` (الصفوف + إجمالي Z) و`sale_head`
  (الرأس الجبائي الكامل) و`sale_duplicata` (صف `sale.duplicata` في نفس الاستدعاء)،
  وكل دوال `sales-book-authority` أصبحت invoke-first مع بقاء loopback للتطوير.
  الـ invoke هو حد المصادقة — لا توكن داخل الصندوق.
- **البوابات**: `cargo 41/41` (اختبار أصلي جديد: يوم + رأس + duplicata + AVOIR)،
  `tsc` + `437/437` + `lint` نظيفة.
- سلوك المتصفح/التطوير بلا أي تغيير (نفس الـ loopback lane).

## v1.5.2 (2026-11-10) — دفتر المبيعات الكامل P1–P4 (النطاق: ADR-043)

**السياق** (طلب المالك بعد الاستخدام الحقيقي): «غموض الحسابات» — المستخدم لا يجد أين يراجع مبيعاته بتفاصيلها ولا يستطيع الرجوع لوصل أو إعادة طبعه. التشخيص: فجوة جسر على مستوى الوصل، لا خلل في المحرك الجبائي.
- **P1 قائمة اليوم**: تبويب يومي **المبيعات/Ventes** — كل وصولات اليوم (الأحدث أولًا) بعدّاد ومجموع، مع الزبون وشارة AVOIR والملغاة ظاهرة.
- **P2 Duplicata محوكم**: زر بسبب اختياري يُسجَّل `sale.duplicata` (الفاعل + السبب ≤140) **قبل** الطباعة، والورقة مختومة `DUPLICATA`؛ رفض ودود للجلسة بلا تصريح، ولا نسخ صامتة أبدًا.
- **P3 بحث + فلاتر + CSV**: بحث FACT/تذكرة متسامح + كاشير + طريقة دفع + شرائح (الكل/AVOIR/ملغاة/مسجل/عابر) + تصدير `ventes-{day}.csv` (FR/AR + BOM) — توابع نقية مُختبَرة، بلا تغيير في الخادم.
- **P4 بطاقة الصحة**: المجموع − AVOIR = الصافي + نقدي/بنكي+كريدي + شارة مطابقة تُقاطع `/api/z/summary` (الملغاة خارج المجموع).
- **البوابات**: `tsc` + `437/437` + `cargo 40/40` + `lint` + ممرا `lane-sb`/`lane-p34` (داكن + فاتح PASS بلا أخطاء) + تنزيل CSV حقيقي مثبت.
- B2-6 يبقى خارجًا (ADR-042/043) — خطة مستقلة.

## Unreleased — محطة التفعيل الاحترافية v4 (P0+P1+P2)
- **P0 سلامة وأمان**: قفل تسلسلي للدفتر (التزامن لا يشعّب السلسلة — مثبت باختبار تزامني ×5)،
  رمز مشغّل لكل POST (`x-baraka-desk` + شاشة فتح + زر قفل)، كشف التكرار (409 + تجاوز صريح مدقق)،
  نسخة احتياطية تلقائية مع كل إلحاق، تحذير صلاحيات PEM، استبدال `window.alert/confirm` بنوافذ وتنبيهات داخلية.
- **P1 عمليات**: دليل محلات مشتق + بيانات عميل (هاتف/ولاية/مقبوض — خارج الهاش، توافق تام)،
  تدفق استبدال موجه (إصدار + إلغاء)، سجل تدقيق `desk-audit.log` + تبويب، تصدير CSV/JSON، فحص ملفات النسخ.
- **P2 لمسات**: لوحة قيادة بمنحنى SVG، مفاتيح مقنعة مع كشف، صيغة إملاء مجزأة، إيصال طباعة ثنائي عربي/فرنسي،
  اختصارات Alt+1…6، تأكيد صريح قبل التوقيع (تكافؤ مراسم الـ CLI).
- **البوابات**: `tsc` + `test:all` (اختبارات v4 معزولة عبر `DESK_DATA_DIR`) + `vite build` (مدخل `desk.html`).

## v1.5.1 (2026-11-07) — مكتب الإرجاع + إصلاحات الصندوق الحية (النطاق: ADR-042)

**النطاق** (قرار المالك 2026-11-07: شحن الآن بما اكتمل؛ B2-6 لخطة مستقلة — ADR-042):
- **UX-1.5.1**: رخصة مؤسسية بلا سعر + هوية Baraka DEV (هاتف + بريد + عنوان برج بوعريريج) + حذف الميزان من الشريط العلوي + توحيد الثيم فاتح/داكن (فاحص التباين أخضر) + خطة موثقة (`docs/PLAN-v1.5.1-UX.md` + §6).
- **مكتب الإرجاع**: hero بأربع بوابات + بطاقات 01/02/03 + بحث متسامح عن الفاتورة (دقيق ← أرقام قصيرة ← لاحقة فريدة، TS + Rust + اختبارات، تطبيع الواجهة + تركيز تلقائي).
- **F3 Remise**: إصلاح جذري مزدوج — الاستهداف اللاصق (دائماً آخر سطر) + سرقة التركيز (إعادة التسليح عند الإغلاق فقط) — مثبت حياً (3 أسطر ← الأخير ← -10% على السطر الصحيح، داكن/فاتح).
- **F6 الميزان**: مكتب 1·2·3 (بحث صنف + لوحة LED ومولّدات ±50/±100غ + ربط RS-232/USB + تذكرة الحقن) — مراجعة بصرية 9/10 داكن، PASS فاتح.

**البوابات**: `tsc` + `test:all 422/422` + `cargo test 40/40` + `lint` + إثباتات Edge (lane-ret + lane-f3، داكن + فاتح، بلا أخطاء صفحة).

## v1.5.0 (2026-11-07) — الإرجاع + Utilisateurs Plus: النسخة المدمجة الواحدة (ADR-040)

**النطاق المدمج** (قرار المالك 2026-11-05: لا 1.4.10 منفردة، مهلة 7 أيام، شخصان فوق 5000 دج، الأرقام الثلاثة ليست شرطاً — استثناء موثق لمرة واحدة في ADR-040، §7 يبقى ملزماً بعده):

**B1 — إرجاع السلعة (RETURNS):**
- مسودة → اعتماد/رفض: `returns` + `return_items` (UUID نصي)، `client_return_key` للـ Idempotency، نافذة 7 أيام (`RETURN_WINDOW_DAYS`)، عتبة الشخصين فوق 5000 دج (المُعتمِد ≠ المنشئ + رتبة مدير على الأقل).
- `posting_day` يوم الاعتماد، الطابع الجبائي غير مسترد، Z يُجمع صافياً مع `returns_count/returns_total_ttc_ct` وسلسلة `z_hash(prev,number,day,nttc,timbre)`.
- بحث المسودة بـ FACT أو UUID (`sale_for_return`)، إيصال BON DE RETOUR (RET + مصدر FACT + مسترد + توقيعان)، شاشة إرجاع كاملة + تبويب يومي.
- المساران التوأم: TS DAL + Rust أصلي (`return_*`/`sale_for_return`) + `uuid v4`، ترحيل v8→v9.

**B2 — Utilisateurs Plus (بنود 1-5 منجزة؛ البند 6 مؤجل — انظر ADR-041):**
1. سبب التجميد إجباري (`RESIGNED|LEAVE|MISUSE|OTHER` + ملاحظة ≤140، يُمسح عند التفعيل، مناعة المالك) — ترحيل v9→v10.
2. الخط الزمني للمستخدم (فلتر actor/action/search + تصدير CSV `;`+BOM).
3. رمز مؤقت ببوابة مالك مزدوجة + تغيير إجباري + انتهاء تلقائي (`pin_expires_at` مستقبلي، `temp-expired`، صلاحيات 8/24/48h) — ترحيل v10→v11.
4. تدوير إجباري دوري (نافذة meta افتراضي 90، 1..365 + تدقيق، تذكير ≤7 أيام بشريط وشارات، `pin_changed_at` ساعة التدوير).
5. مالك ثانٍ بتأكيد رمز مالك موجود (إثبات حضور، توثيق مضاعف `owner.confirm` + `user.create`) بدل الـ confirm الواحدة.
- **مؤجل لـ v1.5.1**: البند 6 (الجلسات الحية + زر الإسقاط) — يتطلب بنية حضور عبر الأجهزة خارج معمارية المحل-الواحد الحالية؛ القرار والمسوغ في ADR-041.
- قاعدة الشخصين للإرجاع ≥5000 دج (B1) — مكتملة ومثبتة حياً.

**البوابات**: `tsc` نظيف + `test:all 406/406` + `cargo test 34/34` صفر تحذيرات + `npm run build` + `cargo build` صفر تحذيرات + حديدية حية (FACT-2026-000001 → RET-2026-000001 → Z-2026-000001 مسلسلة، IRON PASS) + إثباتات Edge لكل بند.

## v1.4.10 (2026-11-05) — التثبيت: T8b + تصفير التحذيرات + اكتمال الطقم (Phase A)

**T8b — Utilisateurs تعمل في المثبت:**
- **السبب**: تدقيق مؤسسي لصفحة `Paramètres & Fiscalité → Utilisateurs` أثبت أن مسار الكتابة ميت في الإنتاج — `createSessionUser`/`setSessionUserActive` يعودان `null/false` فوراً تحت Tauri ولا أوامر مسجلة في `main.rs` (نفس عائلة #PROD-LOCAL/#PROD-SALE/#PROD-CASH). ثانوياً: الحسابات الجديدة بلا `must_change_pin`، الأخطاء بلا سبب مسمى، الصفحة لا تجلب عند الفتح، وحقل PIN نص مكشوف بلا تأكيد.
- **الإصلاح**: `user_create`/`user_set_active` أصليان (Rust + تسجيل Tauri) ببوابة المالك ونفس مصفوفة التحقق في المسارين + `must_change_pin=1` لكل حساب جديد + `lastUserLaneError()` للأسباب المسماة + إعادة بناء الصفحة (جلب عند الفتح، حقول مسماة، PIN بكلمة سر وتأكيد، تأكيد الإجراءات المدمرة، تجميد الذات/المالك مع السبب، رسائل AR/FR دقيقة).

**Phase A — تثبيت:**
- تصفير تحذيرات Rust ‏26 ← 0‏ عبر `rename_all = "camelCase"` على الأوامر العشرة (السلك مطابق بايتاً، TS بلا مساس) + إصلاح 3 أقواس زائدة.
- أرشفة وسم `v2.0.0-mkt` (سلف تاريخي داخل الشجرة، لا يُبنى عليه) + تصحيح §12.3 (print-lane حي وله منادون) + إبقاء `isSessionLive`/`pin.reset` عمداً — كلها في ADR-039.
- اكتمال الطقم: `QA-USERS-AUDIT.md` (9/9) + دليل تغيير PIN (AR/FR) + دفتر الجلسة الحديدية.
- **البوابات**: `tsc` + `test:all 392/392` + `cargo test 31/31` + `cargo build` صفر تحذيرات + `npm run build` ناجح. الإثبات الحديدي على المثبت: جلسة ما بعد الإغلاق (RUNBOOK) — النشر (tag/sign/publish) معلق حتى أرقامها.

## v1.4.9 (2026-11-05) — المسارات الأخيرة تُستقل: نسخ + خسائر + سجل Z أصلياً (#PROD-LOCAL)
- **السبب**: مسح شامل لكل `fetch(:3100)` وجد ثلاثة مسارات تموت في المثبت بلا خادم: (1) النسخ الساخن — الزر يفشل بـ`Failed to fetch` رغم أن أمر `backup_db` الأصلي موجود ولا أحد يناديه؛ (2) خسائر المخزون — تبقى محلية ولا تصل القاعدة الجبائية في الإنتاج؛ (3) سجل Z — لا إعادة طباعة ولا سلسلة بعد إعادة التشغيل.
- **الإصلاح**: `record_loss` + `backup_create`/`backup_list` + `z_list` أوامر أصلية جديدة (Rust) + توصيل أصلي-أولاً في الواجهات الثلاث. الاستعادة/التنزيل عبر HTTP تبقى loopback حصراً مع عرض المسار الدقيق للنسخ اليدوي USB وتوجيه صادق.
- **البوابات**: `tsc` + `test:all 389/389` + `cargo prodlocal 2/2` + كامل Rust (لاحقاً) — الإثبات الحديدي على المثبت لاحقاً.

## v1.4.8 (2026-11-05) — البيع يعمل: فخ العميل الشبح (#PROD-SALE)
- **السبب الجذري (مُثبت على المثبت)**: كل بيعة عابرة (`client_id: 1` لزبون غير موجود في جدول `clients` الفارغ) كانت تموت بـ`FOREIGN KEY constraint failed` أصلياً — مثبت حياً على v1.4.7 بسطر `⚠` الجديد نفسه. على التطوير كانت تنجح لأن قاعدة التطوير تحوي العملاء — لهذا «تعمل فقط في بيئة التطوير».
- **الإصلاح**: `record_sale` (Rust + TS توأم): العميل المجهول ⇒ `NULL` (عابر، الاسم محفوظ) لبيوع النقد؛ `CREDIT` لعميل مجهول ⇒ رفض مسمى `client inconnu`. المنتجات كانت محميةة أصلاً (NULL للشبح).
- **البوابات**: `tsc` + `test:all 389/389` + `cargo prodsale` + إثبات حديدي: بيع أصلي كامل على المثبت يدخل `sales` والحسابات بلا طابور.
- **ملاحظة harness**: تجاوز `APPDATA` في الاختبار يشارك مخزن WebView (Chromium) بين النسخ — القاعدة والواجهة يتباعدان؛ في الإنتاج (بلا تجاوز) متطابقان دوماً. البذور A/B على ملفات نقية تثبت البوابة.

## v1.4.7 (2026-11-05) — الفشل الصامت ممنوع + تثبيت نظيف (#PROD-FAIL)
- **السبب**: على جهاز مستخدم (v1.4.6): بيعتان عالقتان في الطابور الصادر بلا سبب ظاهر + تثبيت جديد يأتي بكتالوج/ديون تجريبية. التشخيص: (1) سبب الرفض الجبائي كان يُبتلع (`catch { auth = null }`) — لا أحد يعرف لماذا رُفض البيع؛ (2) زر «إغلاق Z» بلا أي تأكيد — نقرة عرضية تُجمّد اليوم قانونياً فيُرفض كل بيع بعده؛ (3) البذور التجريبية تُزرع في المثبت.
- **لا مزيد من الصمت**: `lastLaneError()` يلتقط سبب كل رفض (native invoke / loopback HTTP + نص الخطأ)؛ `replayOutbox` يُخزّن `lastError` على السطر العالق؛ الواجهة تعرض `⚠ سبب الرفض` تحت كل عملية؛ أول رفض يُختم في الطابور مع سببه.
- **الإغلاق اليومي مقفل**: `handleClose` في `DailyZReportView` يطلب الآن تأكيداً صريحاً بالعواقب (لا رجعة + تجميد البيع + إرشاد للـClôture أولاً).
- **التثبيت الجديد فارغ**: `demoSeedAllowed()` — المثبت (`isTauriRuntime`) يبدأ بلا منتجات/عملاء/موردين/مشتريات تجريبية؛ المحلات المحفوظة (localStorage) لا تُمس؛ المتصفح-التطوير وحده يحتفظ بالبذور.
- **العقد مثبت**: اختبار Rust `prodfail_ui_payload_shape_commits` — حمولة الـcheckout الحرفية (U- cashier + regime + breakdown 0/9/19) تُلزم على قاعدة v8 جديدةة؛ اختبارات `sale-outbox` (12/12) تُبرهن تخزين السبب وبقاءه بعد إعادة التحميل.
- **البوابات**: `tsc` + `sale-outbox 12/12` + `cargo prodfail` أخضر قبل البناء.

## v1.4.6 (2026-11-05) — الاستقلال الإنتاجي: المسار النقدي الأصلي (#PROD-CASH)
- **السبب**: على أجهزة المستخدمين (بلا خادم `127.0.0.1:3100`) كانت صفحة Clôture ميتة (`Mode autonome`) ومسار مصروف POS (`postTillExpense`) صامتاً — فالمعادلة النظرية تفقد المصاريف وZ diff خطأ. على جهاز التطوير كان خادم التطوير يغطي الخلل.
- **Rust**: مسار `cash_open/cash_movement/cash_active/cash_sessions/cash_movements/cash_close_and_z` في `fiscal.rs` — توأم دقيق لدلالات الخادم (جلسة OPEN واحدة، حراس F3/F4، النظرية الحية، إغلاق SHIFT ذري مع Z مسلسل + قفل اليوم) + اختبار `cash_lane_open_move_status_close`.
- **الواجهة**: `CashSessionsView` و`postTillExpense` تعملان **invoke-first** (أصلي في المثبت، loopback في متصفح التطوير)؛ `offline` لا تظهر إلا عند غياب المسارين معاً.
- **البوابات**: `tsc` + `test:all` + `cargo` + lane حديدي حقيقي **والخادم مطفأ** (`:3100` DOWN).

## v1.4.5 (2026-11-05) — إقفال التدقيق المؤسسي: F2/F6/F8 + قفل الانجراف + الشحن
- **F2 (قرار المالك)**: اليوم القانوني = **Africa/Algiers المحلي** في كل الكتب — `fiscal-day.ts` الجديدة (`fiscalDayISO` + `fiscalDayBoundsUTC` + 4 اختبارات)؛ `computeDayAggregates` يجمع نافذة UTC `[D-1 23:00Z, D 23:00Z)`؛ حراس البيع/الإلغاء/الإغلاق + `/api/z/summary` + مرشحات الواجهة كلها محلية؛ اختبار حافة (بيع 00:30 محلياً لليوم الجديد + قفله يجمده).
- **قفل الانجراف (قرار المالك)**: مفتاح سليم على جهاز مختلف يقفل البيع حتى إعادة التفعيل (`licenseCryptoOk` يميز المزور عن المنحرف في اللافتات)؛ السجلات القديمة بلا hwid تبقى معفاة (تحذير فقط).
- **F8**: سجل الحركات — `listCashMovements` + `GET /api/cash/movements` + بطاقة «سجل الحركات» في الإغلاق (وقت/نوع/سبب/مبلغ، تُحدَّث مع الـpoll).
- **F6**: لا اسم احترازي صلب — الافتتاح يرفض بلا اسم (K5).
- **رقم الدعم الرسمي**: `+213 770 80 70 05` في صفحة الترخيص.
- **البوابات**: `tsc` + **386/386** + `lint` + lanes حية (X2 معادلة الصندوق + X3 قفل الترخيص + F2 اليوم المحلي + F8 السجل + L مرفوض) بلا أخطاء.
- تراكمية: تحتوي كل إصلاحات التدقيق (suppliers M1-M7 + dettes D1-D12 + compta C1-C10 + Z1-Z14 + cloture K1-K14 + licence L1 + cross X1).

## v1.4.4 (2026-11-04) — بحث الموردين + مصاريف/عمال + بداية آمنة
- **P1**: بحث لحظي للمنتج في استلام الموردين من أول حرف (FR/AR/باركود، ≤60 نتيجة، لوحة مفاتيح كاملة) — lane أخضر.
- **P2**: مصاريف المحل (8 فئات SCF) تخرج من الصندوق عبر `EXPENSE` وتظهر في بطاقة Z؛ حساب العمال (سلف `425` + تسوية راتب شهرية `631` تُقاص، حارس عدم التكرار)؛ أدوار (كاشير يسجل / مدير+ يدير ويسوي) — lanes خضراء + يومية SCF.
- **P3**: بداية آمنة — لقطة إجبارية معفاة من الحذف + `factory_reset` أصلي مدقق (يرفض بلا أرشيف مطابق، مسح داخل `Immediate tx`، صف genesis، الترقيم يعود `000001`) + استعادة انتقائية للمرجعية فقط (منتجات/موردون/ديون/عمال — الحركات والترقيم لا تُمس).
- **البوابات**: `tsc` + **350/350** + `cargo 23/23` + `lint` + `build` + lanes حديد (معالج + سلسلة تصفير/استعادة كاملة + شارة الإعفاء).
- تراكمية: تحتوي كل ما في 1.4.3 (regime + IO + Backup-Pro + شريط + إصلاحات المحدّث).

## v1.4.3 (2026-11-04) — اكتمال تدقيق الإقلاع (catch-up)
- **إصلاح ذاتي**: اكتُشف على الحديد أن مفتاح النسخة (جديد في 1.4.2) يجعل الترقية من
  بناءٍ أقدم تبدو «تثبيتاً جديداً» صامتاً — أُضيف فحص البصمة (أي مفتاح `baraka_*`
  آخر) فيُؤرشف اللحاق كترقية بمصدر `pre-1.4.2`. وإلا لابتلعت الفجوة دليلها نفسها.
- **البوابات**: `tsc` + `6/6` + lane لحاق (بصمة بلا مفتاح → ختم + شاشة قفل بلا أخطاء).

## v1.4.2 (2026-11-04) — تدقيق الإقلاع + توحيد الفوتر
- **سد فجوة التتبع**: المحدّث قد يبدّل الثنائية دون مرور بمسار التحديث (تثبيت صامت) —
  الآن كل إقلاع يقارن النسخة المخزنة بالحالية و**يؤرشف أي تحول** (`system/update.install`
  `1.4.1 → 1.4.2 (upgraded, silent/boot-detected)`)؛ `detectVersionShift` خالصة + 5 اختبارات.
- توحيد حرف الفوتر `v` → `V` حرفياً (زال الاعتماد على CSS وحدها).
- تراكمية: تحتوي كل ما في 1.4.1 (إصلاح المسار الأصلي v7 + احتفاظ + شريط + regime/IO/Backup).
- **البوابات**: `tsc` + **337/337** + `lint` + `cargo 21/21` + lane إقلاع (شاشة قفل بلا أخطاء).

## v1.4.1 (2026-11-04) — إصلاح حرج: المسار الأصلي v7 + ضمان التراكمية
- **عطل v1.4.0 (مكشوف بشفافية)**: خطوة الترحيل v6→v7 تكتب `user_version=7` بينما
  الثابت الأصلي بقي `LATEST=6` — فأول تشغيل يرقّي القاعدة ثم **كل** الأوامر الأصلية
  اللاحقة تُرفض (`newer than this build`): الدخول، التدقيق (قراءة/كتابة)، `db_status`.
  على الحديد ظهر هذا كـ: فشل الدخول + تبويب تدقيق فارغ أبدياً + غياب صفوف التحديث.
- **الإصلاح**: `LATEST_SCHEMA_VERSION = 7` + اختبار انحدار جديد
  `migrate_reopen_after_climb_stays_ok` (مثبت أنه يفشل مع 6 ويمر مع 7) — أي نسخة
  مستقبلية تكتب N يجب أن تقبل N عند إعادة الفتح.
- **ضمان التراكمية** (مطلب المالك): المثبت NSIS حزمة كاملة (لا تفاضلي) — القفز من
  أي نسخة قديمة (v1.3.3…) إلى الأحدث يجلب كل شيء تلقائياً؛ و`migrate()` بخطوات
  `if v < N` يتسلق أي قاعدة قديمة إلى الأحدث في فتح واحد (مغطى باختبار v1→v7 +
  اختبار إعادة الفتح). ملاحظات `latest.json` تراكمية منذ v1.3.5.
- يشمل كل ما في v1.4.0 (الشريط الجديد + إصلاح الاحتفاظ) + هذا الإصلاح.
- **البوابات**: `cargo 21/21` + `tsc` + **332/332** + `lint` + `build`.

## v1.4.0 (2026-11-03) — إعادة تصميم الشريط العلوي
- **معمارية ثلاثية المناطق**: مهام اليوم ظاهرة (الكاشير/المخزون/الموردون/الديون) +
  زر «المزيد ⋯» للإدارية (المحاسبة/Z/إغلاق/الرخصة/الإعدادات بنصوصها) — نفس الـRBAC،
  نقل فقط بلا حذف وظيفة. التفاصيل: `docs/NAVBAR-REDESIGN.md`.
- شارة الجلسة دائمة (قفل/خروج على كل الأحجام) + ساعة حية `HH:MM:SS•DD/MM` +
  زر تعليق واحد بعدّاد (التعليق صف داخل القائمة، F4/F5) + فصل حالة الميزان عن فعله +
  `aria-current/label/pressed` + حلقة تركيز زمردية + نقطة توقف 1100px (أيقونات فقط).
- إثبات lanes 7/8/9 (1366+1024، AR/FR): لا قصّ ولا تداخل ولا تمرير أفقي.
- **البوابات**: `tsc` + **332/332** + `lint` + `build`.
- **النشر**: نفس بروتوكول v1.3.5 (nsis → توقيع rsign → `SIG-OK` → `latest.json`
  `windows-x86_64` → release ثلاثي الأصول → تثبيت حديد موثق).

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
