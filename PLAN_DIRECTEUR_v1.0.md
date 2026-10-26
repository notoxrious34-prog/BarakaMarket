# BARAKA MARKET v1.0 — المخطط المديري الشامل حتى التسليم
**PLAN DIRECTEUR — De l'état actuel (Google AI Studio / Gemini 3.8) jusqu'à la livraison boutique**

> المجلد: `D:\Dev\baraka-market` — الحالة المقاسة بتاريخ 26/10/2026
> Stack الحالي: React 19 + Vite 8 + Tailwind 4 + TypeScript ES2022 — ~6 102 سطر في `src/`
> التخزين الحالي: `localStorage (baraka_*_v2)` — لا يصلح للإنتاج
> الدستور المعماري الملزم: Zero-Cloud / SQLite WAL / TVA 0-9-19% / Timbre ESPECES فقط / Integer-Centimes / تسلسل فواتير ذري / Zero-Mouse <150ms / AR-FR RTL/LTR / <120MB RAM / <60MB EXE

---

## 0. التشخيص الحقيقي (AS-IS Audit) — ما بناه Gemini 3.8

### 0.1 ما يعمل فعلاً (نقاط قوة)
- دورة كاملة: `PosView (544L) → PaymentModal (322L) → Ticket80mm (245L) / FactureA4 (300L)` + `ProductsStock (607L)` + `SuppliersPurchases (920L) → PMP` + `CarnetDette (527L)` + `AccountingJournal (329L)` + `DailyZReport (249L)` + `LicenseManager (254L)` + `StoreProfile (279L)`.
- محرك جبائي `fiscal.ts (313L)` سليم المبدأ: `HT = TTC/(1+taux/100)`، طابع `1% / min 10 / max 2500 / ESPECES فقط / إعفاء <50 دج`، باركود ميزان `20/22XXXXX…`، `numberToWordsFR/AR`، `formatDZD`.
- اختبارات `fiscal.test.ts (157L)` + `accounting.test.ts (140L)` بـ `node:test` تغطي الحالات الذهبية (1776→18 دج طابع، TVA 0/9/19).
- ثنائي اللغة AR/FR، KG بالفواصل، Hold/Restore للسلال، محاكاة ميزان، مسودة سلة نشطة.

### 0.2 الفجوات الحرجة (تُسقط الإنتاج لو تُركت)
| # | الفجوة | الدليل | الخطورة |
|---|--------|--------|---------|
| G1 | `float + Math.round(x*100)/100` في كل الحسابات | `fiscal.ts:26-28,100-107` + `accounting.ts:31,71` | تراكم ±0.01 دج → كسر Fiscal Determinism |
| G2 | `localStorage ~5MB` قابل للمسح، لا WAL ولا ذرية | `AppContext.tsx:112-125, STORAGE_KEYS` | فقدان المبيعات + تكرار الفواتير |
| G3 | تسلسل `FACT-2026-XXXX` برمجي بدون قفل | `completeSale()` في AppContext | ثغرة قانونية (فواتير مكررة/محذوفة) |
| G4 | لا يوجد Backend رغم وجود `express+dotenv` في package.json | لا يوجد `server/` | لا SQLite ولا طباعة خام ولا ميزان حقيقي |
| G5 | لا قياس أداء `<150ms` ولا سقف موارد | لا يوجد bench | POS قد يتجمد عند 100+ سطر |
| G6 | `node_modules` غير مثبت | `npm run dev` مستحيل حالياً | بيئة غير جاهزة |

**القرار المعماري:** لا نرمِ ما بناه Gemini — نُصلّبه. الواجهات تُحفظ، المحرك والطبقة التحتية تُستبدل.

---

## 1. المعمارية المستهدفة (TO-BE) — Zero-Cloud / Single-EXE

```
┌─────────────────────────────────────────────┐
│  FRONT (React 19 + Vite + Tailwind) — محفوظ  │  Zero-Mouse / <150ms / AR-FR
│  PosView / Stock / Fournisseurs / Dette / Z │
└──────────────┬──────────────────────────────┘
               │ IPC / HTTP localhost فقط (لا Cloud)
┌──────────────▼──────────────────────────────┐
│  CORE ENGINE (TypeScript/Node)              │
│  • fiscal.centimes.ts (int فقط)             │
│  • invoice-sequencer (AUTOINCREMENT+UNIQUE) │
│  • scale-parser / print-escpos / license    │
└──────────────┬──────────────────────────────┘
               │ better-sqlite3, WAL, FK ON
┌──────────────▼──────────────────────────────┐
│  DATA (SQLite WAL, ملف واحد baraka.db)      │
│  products / sales / sale_items / clients /  │
│  suppliers / purchases / z_reports / seq    │
└─────────────────────────────────────────────┘
Packaging: Tauri 2.x (موصى — ~15-25MB) أو fallback: Node+Bun single-exe + WebView
 ceilings: RAM <120MB ( measured Task Manager ), EXE+DB <60MB بدون أرشيف المبيعات
```

**قواعد صارمة (Dostour):**
1. كل مبلغ = `integer centimes (DZD*100)` من الحاجز إلى الطباعة. يُمنع `float/double/number` للمبالغ. العرض فقط يقسم على 100.
2. TVA حصرياً `0/9/19`. أي قيمة أخرى = رفض + خطأ مكتوب.
3. Timbre = `ceil(TTC*1%)` مقيد `[10,2500]`، فقط `ESPECES` و `TTC>=50`. غير ذلك = 0.
4. الفاتورة: `FACT-YYYY-NNNNNN` تسلسل ذري (`BEGIN IMMEDIATE` + جدول `invoice_seq`)، لا حذف فيزيائي أبداً (`status=CANCELLED` + سجل `void_log`).
5. العربية RTL والفرنسية LTR في كل شاشة وكل مطبوع.

---

## 2. خارطة المراحل حتى التسليم (6 مراحل + بوابات 72h)

### PHASE 0 — التثبيت والقياس (J0 → J2) — Gate G0
**الهدف:** بيئة قابلة للتكرار + خط أساس أداء.
- T0.1 `npm install` + `npm run dev` + `npx tsc --noEmit` — يجب أن يكون أخضر. توثيق أي خطأ.
- T0.2 تجميد نسخة `v0.9-aistudio` (git tag) + نسخة احتياطية `baraka.db` فارغة.
- T0.3 قياس خط الأساس: زمن إضافة سطر POS (100 سطر)، زمن `completeSale`، استهلاك RAM. أدوات: DevTools Performance + `node --test`.
- T0.4 تثبيت أدوات السقف: `pygount` للLOC، سكربت `bench-pos.mjs`، سكربت `check-size.mjs`.
- **Acceptance G0:** `tsc` أخضر + `node --test` أخضر + تقرير bench محفوظ في `docs/BASELINE.md`. لا ننتقل بدونها.

### PHASE 1 — GENESIS: المحرك الجبائي الحتمي (J3 → J8) — Gate G1 (72h)
**الهدف:** القضاء على G1 نهائياً. TDD صارم (RED→GREEN→REFACTOR).
- T1.1 `src/core/money.ts`: نوع `Centimes = number(int)` + `dzdToCentimes/toDZDText/formatDZD` + حارس `assertInteger`. اختبار: رفض float.
- T1.2 `src/core/fiscal.centimes.ts`: إعادة كتابة `calculateLineTotals/saleTotals/timbre` بالـ centimes. الصيغ: `HT = round(TTC*100/(100+taux))`، `TVA=TTC-HT`، `Timbre=ceil(TTC*1%)`. اختبارات ذهبية: `(180×2,9%)→HT 33028ct`، `(120×3,19%)→30252ct`، `(1776 ESPECES)→18 دج`، `(200 ESPECES)→10`، `(CIB)→0`.
- T1.3 ترحيل `SaleItem/Sale` إلى centimes + محوّل `migrate-legacy-float.ts` (للـ localStorage القديم).
- T1.4 `numberToWordsFR/AR` من centimes + `parseScaleBarcode` مع اختبارات `2000040014501→1.450kg`.
- T1.5 تشغيل `PosView/PaymentModal` على المحرك الجديد (Adapter فقط، لا redesign).
- **Acceptance G1:** كل المبالغ int في الاختبارات + `fiscal.centimes.test.ts` أخضر 100% + لا `Math.round(x*100)/100` على مبالغ في `src/core/`. مراجعة مستقلة (skill requesting-code-review).

### PHASE 2 — PERSISTENCE: من localStorage إلى SQLite WAL (J9 → J16) — Gate G2
**الهدف:** القضاء على G2+G3+G4.
- T2.1 سكيما `db/schema.sql`: جداول `products/sales/sale_items/clients/suppliers/purchases/z_reports/invoice_seq/void_log` + `PRAGMA journal_mode=WAL; foreign_keys=ON;` + فهارس barcode/date.
- T2.2 طبقة `db/sqlite.ts` (better-sqlite3): `BEGIN IMMEDIATE` للبيع، `nextInvoiceNumber()` ذري، `voidSale()` بدون حذف.
- T2.3 مهاجر `migrate-localstorage-to-sqlite.mjs`: يقرأ مفاتيح `baraka_*_v2` → يحقن في SQLite + تقرير عدّادات. يُحفظ كأداة تسليم للمحلات التي جرّبت النسخة Web.
- T2.4 استبدال `AppContext` persistence: SQLite أولاً، localStorage كـ cache للمسودة فقط (`ACTIVE_DRAFT`).
- T2.5 نسخ احتياطي تلقائي: زر + عند كل Z (`VACUUM INTO backup-YYYYMMDD.db`) + اختبار استعادة.
- **Acceptance G2:** فصل الكهرباء أثناء بيع → لا فقدان ولا تكرار (اختبار kill -9) + 1000 فاتورة متتالية بدون فجوة + حجم `baraka.db` موثق.

### PHASE 3 — ERGONOMICS: كاشير Zero-Mouse <150ms (J17 → J23) — Gate G3 (72h)
**الهدف:** سرعة البيع الحقيقية.
- T3.1 خريطة اختصارات: `F1 بحث / F2 وزن / F4 خصم / F8 تعليق / F9 استرجاع / F12 دفع / Esc إلغاء` + شريط تلميحات دائم. لا وظيفة تتطلب فأرة.
- T3.2 بحث فوري `<150ms` على 10k صنف (فهرس SQLite FTS5 + debounce 80ms + virtual list). قياس bench.
- T3.3 ميزان حقيقي: Serial/USB-HID (CAS/DIGI) + وضع محاكاة موجود + `22/20` parser من Phase 1. اختبار وزن 1.450kg end-to-end.
- T3.4 طابعة حرارية 80mm خام ESC/POS (USB) + معاينة + إعادة طباعة آخر تيكت بزر واحد.
- T3.5 RTL/LTR تدقيق: كل شاشة + كل مطبوع AR+FR بدون كسر.
- **Acceptance G3:** فيديو بيع 10 أصناف (منها ميزان) بالكيبورد فقط <60 ثانية + bench `<150ms` للسطر + اختبار أمّي (user non-technicien) ينجح بدون تدريب.

### PHASE 4 — CLOSING: الإغلاق القانوني والمحاسبة (J24 → J30) — Gate G4 (72h)
**الهدف:** قانونية الفواتير + صحة المخزون والديون.
- T4.1 `FactureReglementaireA4`: حقول RC/NIF/NIS/AI للمتجر والزبون + تفصيل TVA 0/9/19 + مبلغ حرفاً FR/AR + رقم متسلسل + منع الطباعة بدون NIF للفواتير الرسمية.
- T4.2 `TicketThermal80mm`: إجمالي + طابع سطر مستقل + تذييل الشكر + رقم T.
- T4.3 `DailyZReport (Z-YYYYMMDD-NN)`: إغلاق يومي غير قابل للتعديل (قفل + hash SHA-256 للسطر) + مجاميع ESPECES/CIB/Dahabiya/Credit + زر نسخ احتياطي إجباري قبل الإغلاق.
- T4.4 `CarnetDette`: سقف ائتمان + تنبيه تجاوز + تسوية نقدية تُخضع للطابع لحظة التحصيل (ليس لحظة البيع الآجل).
- T4.5 `PMP (SCF)`: `PMP=(Stock*PMP+Qté*PA_HT)/(Stock+Qté)` بالـ centimes + تقييم مخزون PMP مقابل Retail + CAMV والهامش.
- **Acceptance G4:** محاسب خارجي يصادق على 3 فواتير + Z + مطابقة مخزون فيزيائي ±0 + ميزان ديون = مجموع التسويات.

### PHASE 5 — HARDENING: الترخيص والسقوف والمتانة (J31 → J36) — Gate G5
- T5.1 ترخيص `HWID→KEY-XXXX-XXXX-BARAKA` (موجود `computeActivationKey`) + وضع Trial 30 يوم + قفل نسخ DB لجهاز آخر بدون نقل رخصة.
- T5.2 سقف الموارد: قياس RAM <120MB (عمل 8h متواصلة) + حجم مثبت <60MB (Tauri strip +=E). تقرير `docs/RESOURCE_CEILING.md` بلقطات.
- T5.3 متانة: انقطاع كهرباء/طابعة/ميزان → رسائل AR/FR واضحة + استئناف بدون فقدان. سجل أخطاء محلي `logs/`.
- T5.4 أمان: لا أسرار في الكود (فحص `requesting-code-review` Step 2) + صلاحيات كاشير/مدير + كلمة مدير لإلغاء سطر.
- **Acceptance G5:** كل فحوصات skill requesting-code-review خضراء + تقرير reviewer مستقل JSON `passed:true`.

### PHASE 6 — DELIVERY: التسليم للمحل (J37 → J42)
- T6.1 مثبت واحد: `BarakaMarket-v1.0-setup.exe` (Windows 10/11 x64) + اختبار على جهاز نظيف بدون Node.
- T6.2 حزمة المحل: `baraka.db` فارغة + seed (الأصناف الـ 8 + BARAKA MARKET) + دليل ورقي A5 (AR/FR، 6 صفحات: بيع/مرتجع/دين/مورد/Z/نسخ احتياطي).
- T6.3 تدريب 2h في المحل + محضر استلام موقع: (Z تجريبي + فاتورة + نسخة احتياطية مستعادة).
- T6.4 ضمان 30 يوم + قناة دعم (هاتف) + سجل `CHANGELOG.md`.
- **Acceptance FINAL (التسليم):**
  - [ ] مثبت <60MB يعمل Offline 100%
  - [ ] بيع نقدي يطبع طابعاً، وCIB بدون طابع
  - [ ] تسلسل 50 فاتورة بدون فجوة بعد kill -9
  - [ ] Z يومي مقفل + نسخة احتياطية مستعادة
  - [ ] RAM <120MB بعد 8h
  - [ ] محضر استلام موقع + نسخة DB للمحل

---

## 3. أوامر التنفيذ (TASK DIRECTIVES) — تُطلق واحداً واحداً

- **#001 CORE FISCAL CENTIMES + DRAFT ENGINE** (يبدأ Phase 1): `money.ts + fiscal.centimes.ts + tests ذهبية + adapter PosView`. المعيار: لا float في core.
- **#002 SQLITE WAL + MIGRATION** (Phase 2): schema + sequencer ذري + مهاجر localStorage.
- **#003 ZERO-MOUSE POS + SCALE + ESCPOS** (Phase 3): اختصارات + FTS5 + ميزان + طابعة.
- **#004 LEGAL CLOSING PACK** (Phase 4): A4 + 80mm + Z مقفل + Dette + PMP.
- **#005 HARDEN + SINGLE-EXE <60MB** (Phase 5+6): ترخيص + سقوف + مثبت + تدريب.

> القاعدة: لا يُفتح Directive جديد قبل إغلاق بوابة السابق (GATE). كل Directive ينتهي بـ `node --test` أخضر + `tsc --noEmit` أخضر + مراجعة مستقلة.

---

## 4. المخاطر وخطة الاحتواء

| الخطر | الاحتمال | الاحتواء |
|------|----------|----------|
| اختلاف PMP المحاسبي عن SCF | متوسط | مصادقة محاسب في G4 قبل التسليم |
| تعريفات طابعة/ميزان صينية | عالٍ | طبقة abstraction + وضع محاكاة + قائمة عتاد معتمد في الدليل |
| تضخم الحجم >60MB (Electron) | عالٍ | اعتماد Tauri؛ fallback WebView2 المدمج في Win10/11 |
| مقاومة الكاشير للكيبورد | متوسط | تدريب + ملصق اختصارات على الكاشا + زر فأرة احتياطي لا يُعلن عنه |
| فقدان DB (سرقة/حريق) | منخفض/حرج | نسختان: USB يومية + مجلد مشفر؛ تذكير إجباري قبل Z |

---

## 5. الجدول الزمني المقترح (6 أسابيع، قابل للضغط إلى 3 بفريقين)

- S1 (J0-J8): G0+G1 — المحرك الحتمي
- S2 (J9-J16): G2 — SQLite + Migration
- S3 (J17-J23): G3 — Ergonomics + Hardware
- S4 (J24-J30): G4 — Closing légal
- S5 (J31-J36): G5 — Hardening
- S6 (J37-J42): التسليم والتدريب

**التكلفة التقديرية للعتاد التجريبي:** طابعة 80mm USB + قارئ باركود USB + ميزان CAS (اختياري أول أسبوعين بالمحاكاة).

---

## 6. القرار المطلوب منك الآن

1. صادق على المعمارية: **Tauri + SQLite WAL** (موصى) أم **Node single-exe**؟
2. أطلق: **TASK DIRECTIVE #001** — أبدأ به فور المصادقة.
3. هل يوجد عتاد حقيقي (طابعة/ميزان/قارئ) أم نعمل بالمحاكاة حتى G3؟

*الملف المرجعي: هذا المخطط هو دستور التسليم. أي تغيير في TVA/Timbre/التسلسل يتطلب تعديل الدستور أولاً.*
