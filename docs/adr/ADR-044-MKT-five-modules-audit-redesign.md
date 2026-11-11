# ADR-044 — تدقيق ومعمارية الوحدات الخمس (Retours · Ventes · Compta · Rapport Z · Clôture)

> **النوع**: تدقيق هندسي/معماري/تصميمي (قراءة فقط — بلا تعديل كود).
> **التاريخ**: 2026-11-11 · **النسخة المرجعية**: v1.7.0 · **المفوض**: المالك.
> **الحالة**: `PROPOSAL` — ينتظر التصريح ببدء التنفيذ (TASK-MKT-006..010).
> **التدقيق الحي 2026-11-11**: `docs/audit/AUDIT-2026-11-11-five-modules-live.md` —
> كل زر ضُغط فعلًا. يؤكد المقترح ويضيف: **[HIGH] أصفار كاذبة في Rapport Z**
> (ذاكرة السياق بدل الـlane) + **سلوك lane غير متسق** (Compta يكتب، Retours/Clôture
> مرفوضان) + تصحيح: شرائح hero في Retours سليمة (01–04 حقيقية).

---

## 1. الملخص التنفيذي

الوحدات الخمس **سليمة وظيفياً** (كل عملياتها جبائياً محوكمة ومختبرة 450/450
TS + 42/42 Rust)، لكنها **غير متجانسة** على ثلاثة محاور: لغة التصميم (ثلاثة
أنماط بطاقات متضاربة)، تموضع المنطق (منطق تجميع وروابط شبكة داخل مكوّنات
React بدل النوى/السلطات)، والحجم (مكوّنات 400–650 سطراً تخلط العرض بالبيانات
بالأحداث). القرار المقترح: **توحيد إلى «سطح مكتب مؤسسي» واحد** (hero + خطوات
مرقمة + Master/Detail + لوحات صحّة) على نموذج `SalesBookView` الناجح، مع سحب
المنطق الجبائي إلى النوى وإخفاء المسارين (invoke/loopback) خلف السلطات.

---

## 2. جدول الحقائق (أُثبت بالقراءة الكاملة)

| # | الوحدة | المكوّن | الأسطر | نمط التصميم الحالي | النواة/السلطة |
|---|--------|---------|--------|--------------------|----------------|
| 1 | Retours | `ReturnsView.tsx` | 638 | Hero + 4 خطوات + بطاقات | `returns-authority.ts` + `claims-authority.ts` |
| 2 | Ventes | `SalesBookView.tsx` | 466 | Hero + 4 خطوات + Master/Detail (`grid [1fr_400px]`) | `sales-book-authority.ts` |
| 3 | Compta | `AccountingJournalView.tsx` | 414 | ترويسة + بطاقات KPI + جدول | `compta-kernel.ts` + `utils/accounting` |
| 4 | Rapport Z | `DailyZReportView.tsx` | 649 | لوحة + بطاقات + جدول TVA + معاينة طباعة مزدوجة | `zreport.ts` + `fiscal-authority.ts` |
| 5 | Clôture | `CashSessionsView.tsx` | 369 | بطاقات (فتح/حركة/إغلاق) + جدولان | `fiscal-authority.ts` |

### حقائق عبر الوحدات
- **ثلاث لغات تصميم**: (أ) hero + خطوات مرقمة (Retours/Ventes) — (ب) بطاقات
  KPI حرة (Compta) — (ج) بطاقات إجرائية (Clôture) — (د) لوحة مركبة + معاينة
  طباعة (Rapport Z). كل وحدة تعيد اختراع الترويسة والأزرار والبطاقات.
- **منطق تجميع جبائي داخل React**: `DailyZReportView.tsx:196-216` يجمّع
  المرتجعات والهالك يدوياً لحظة الإغلاق، و`AccountingJournalView.tsx:50-75`
  يخيط `retLeg/lossLeg` يدوياً — بينما يجب أن يكون ذلك في `fiscal-authority`
  / `returns-authority` القابلة للاختبار.
- **روابط شبكة مصلّبة في المكوّنات**: `DailyZReportView.tsx:83,89,208`
  و`ProductsStockView.tsx:111` و`ProductToolModals.tsx:14` و`BackupManagerView.tsx:8`
  تصلب `http://127.0.0.1:3100` مباشرة (ينتهك مبدأ المسارين — يعمل في المتصفح
  ويفشل في الصندوق المثبت).
- **ازدواج مفاهيمي Z/Clôture**: يوجد مساران صحيحان لكن غير موضّحين بصرياً —
  `z_close` (قفل اليوم القانوني، `close_kind='DAY'`) و`cash_close_and_z`
  (إغلاق الوردية مع العد والفرق، `close_kind='SHIFT'`) — وكلاهما يُسلسل نفس
  `Z-YYYY-NNNNNN`. المستخدم يواجه زرّي «إغلاق Z» في صفحتين دون صلة مرئية.
- **تكرار ترجمة الأخطاء**: `mapReturnError` (ReturnsView:57) خرائط أخطاء
  يدوية طويلة؛ المبدأ نفسه يتكرر مبتوراً في SalesBook (146-150) وCashSessions
  (136) — بلا نواة موحدة `lane-error → رسالة ودية`.

---

## 3. النتائج المكتشفة (مرتّبة بالخطورة)

### 🔴 حرجة (سلامة/جبائية/تصحيح)
- **C1 — تجميع الإغلاق في واجهة React**: أرقام المرتجعات/الهالك التي تُسلَّم
  لـ`commitZClose` تُحسب في `DailyZReportView.tsx` بفلاتر زمنية يدوية
  (`posting_day === date` و`fiscalDayBoundsUTC`) يمكن أن تنحرف عن DAL. يجب
  نقلها إلى دالة أصلية/سلطة واحدة `zClosePayload(day)` مختبرة قِبالة Rust.
- **C2 — روابط loopback في المنتج**: أي سطح يُنقل للمثبت وهو يقرأ
  `127.0.0.1:3100` سيفشل صامتاً في المثبت. كل هذه المواضع يجب أن تمر عبر
  سلطة `invoke-first` (سابقة T12-bis v1.5.3).

### 🟠 معمارية
- **A1 — عدم تفكيك المكوّنات**: 369–649 سطراً/مكوّن. بعد نجاح MKT-004 في POS،
  يجب تطبيق التقسيم نفسه (جزر `memo` + خطافات بيانات) على الوحدات الخمس.
- **A2 — لا فصل عرض/بيانات**: `detailToSale` (SalesBookView:33) و`tv/ct`
  (DailyZReportView:105) تحوّلات DZD↔ct مبعثرة؛ يجب سحبها لنوى `display`/
  السلطة.
- **A3 — خطافا بيانات مكرران**: `refreshClaims` + `refresh` (ReturnsView)
  و`load` + `openDetail` (SalesBook) نُسجتا باليد؛ يمكن توحيدهما في خطاف
  `useAsyncResource`/`usePolled`.

### 🟡 تصميم/UX
- **U1 — فوضى hero**: Retours (amber) مقابل Ventes (emerald) مقابل Compta
  (بلا hero) مقابل Rapport Z (بلا hero، عنوان فقط) — هوية بصرية غير موحدة.
- **U2 — معاينة الطباعة مدمجة في Rapport Z**: `DailyZReportView` يقدّم نافذة
  معاينة 80mm/A4 دائمة (507-645) تستهلك نصف الشاشة — يجب عزلها في modal مثل
  بقية التذاكر (`TicketThermal80mm`).
- **U3 — كثافة بطاقات Compta**: 4 KPI + 3 تحليلات + جدول يومية + مصاريف —
  بلا تسلسل خطوات؛ تحتاج هيكلة «01 نظرة / 02 اليومية / 03 المصاريف».
- **U4 — Clôture بلا تمييز Z-day**: لا مؤشر «اليوم مقفل قانونياً» ولا شارة
  مطابقة مع Rapport Z؛ يجب ربطها بشارة `day_locked` نفسها في Ventes/Rapport Z.

### 🟢 تحسينات
- **G1 — ترقيم/تواريخ موحدة**: `toLocaleString('fr-FR')` متفرقة؛ يجب `latin`
  صريح + `tabular-nums` + `dir="ltr"` لكل الأرقام (قانون C في الدستور).
- **G2 — الحالة Empty/Loading/Error موحدة** في الوحدات الخمس.
- **G3 — اختصارات لوحة مفاتيح** (F-keys) موحدة عبر الوحدات في
  `docs/KEYBOARD-MAP.md`.

---

## 4. مقترح إعادة التصميم والبناء

### 4.1 نظام التصميم الموحّد «Desk» (مستوحى من UltraPOS + SalesBookView)
كل وحدة تلتزم بالهيكل:
```
[ Hero مؤسسي — عنوان + وصف + شرائح خطوات مرقمة ]
[ 01 · نظرة/صحة — بطاقات KPI موحدة الحجم والألوان ]
[ 02 · Master/Detail — قائمة (تمرير داخلي) + لوحة جانبية sticky ]
[ 03 · الإجراء المحوكم — زرا/نموذج مع بوابة الدور + تأكيد ]
[ 04 · السجل/التصدير — جدول + CSV/طباعة ]
```
- ألوان دلالية موحدة: emerald=مال/إنجاز، amber=ضريبة/تنبيه، rose=خطر/رفض،
  sky=بنكي، purple=TVA 19.
- بطاقة KPI واحدة (`MetricCard`) وصفة عمودية موحدة (`ColumnDef`) وجدول موحد
  (`DataTable`) — بدل عشرات النسخ المكررة.

### 4.2 تفكيك الوحدات (خطة TASK-MKT-006..010)

| المهمة | الوحدة | الناتج |
|--------|--------|--------|
| MKT-006 | Retours | `ReturnsDesk` + `ReturnLookupPanel` + `DraftsPanel` + `ClaimsPanel` (جزر memo) |
| MKT-007 | Ventes | تثبيت master/detail + سحب `detailToSale` لنواة + ربط `zMatch` بشارة day-lock |
| MKT-008 | Compta | هيكلة خطوات 01/02/03 + `MetricCard` + سحب `retLeg/lossLeg` لنواة |
| MKT-009 | Rapport Z | عزل معاينة الطباعة في modal + نقل تجميع الإغلاق لسلطة `zClosePayload` |
| MKT-010 | Clôture | ربط `day_locked` بشارة موحدة + مؤشر Z-day + توحيد أزرار الحركة |

### 4.3 نوى/سلطات جديدة (أساس الاختبار قبل الواجهة)
1. `core/lane-error.ts` — `friendlyLaneError(raw, ar)` موحّد (يعوّض كل `mapReturnError`).
2. `core/z-close-payload.ts` — `buildZClosePayload(day, …)` نقيّ (ينقل تجميع C1) + اختبار قِبالة Rust.
3. `core/display.ts` — إضافة `latinTime/latinDateTime` موحّد.
4. `hooks/useAsyncResource.ts` — بديل A3.
5. إخفاء كل loopback خلف `fiscal-authority`/`product-authority` (invoke-first).

### 4.4 قواعد القبول (لكل مهمة)
- بوابة G1–G4 خضراء + ممر بصري `1024×650` و`1366×900` داكن/فاتح لكل وحدة.
- كل سحب منطق يُرافقه اختبار يفشل قبل النقل وينجح بعده (قانون الانحدار).
- الأرقام `latin + tabular-nums + dir="ltr"` في كل صفحة؛ الصفحة `scrollHeight <= viewport` (قفل MKT-002).

---

## 5. مخطط التنفيذ (خريطة الطريق)

| المرحلة | النطاق | المعيار |
|---------|--------|---------|
| P0 · التأسيس | `lane-error` + `MetricCard/DataTable/ColumnDef` + `useAsyncResource` + سحب C2 (loopback) | لا انحدار، اختبارات جديدة خضراء |
| P1 · التطبيق | MKT-006 → MKT-010 بالترتيب (كل وحدة: تفكيك + hero/خطوات + سحب منطق + ممر بصري) | 5 ممرات بصرية PASS |
| P2 · التكامل | ربط `day_locked` عبر Ventes/Rapport Z/Clôture + KEYBOARD-MAP | شارة مطابقة موحدة |
| P3 · الإصدار | bump v1.8.0 + CHANGELOG + ADR-044 + بناء/توقيع/نشر + IRON | RELEASE-GATE PASS |

**التسلسل الموصى به**: MKT-006 (Retours) → MKT-008 (Compta) → MKT-009
(Rapport Z) → MKT-010 (Clôture) → MKT-007 (Ventes، تحسين على نمط ناجح
قائم).

---

## 6. القرار المطلوب

**بانتظار تصريح المالك** بالبدء في التنفيذ (P0 ثم P1)، أو تعديل النطاق/
الأولويات. لن يُلمس أي كود قبل التصريح الصريح.
