# QA-USERS-AUDIT — Paramètres & Fiscalité → Utilisateurs (T8b)

| البند | القيمة |
|---|---|
| النطاق | صفحة إدارة المستخدمين + مساراتها الثلاثة (verify/create/toggle) |
| المعيار | تدقيق مؤسسي بمعيار Microsoft — كلمة-بكلمة، ربط، منطق |
| الحالة | **مغلقة بالكامل** — الإصلاح T8b مُبرهن بالبوابات أدناه |
| المرجع | ADR-031 (T8) + ADR-035 (T12) + ADR-037 (T8b) |

## P0 — حرج (كانت مفتوحة، أُغلقت)

| # | المكتشف | الإصلاح | الدليل |
|---|---|---|---|
| U-P0-1 | مسار الكتابة ميت في الإنتاج: `create/setActive` تُرجع `null/false` فوراً، ولا أوامر مسجلة في `main.rs` | أمران أصليان `user_create/user_set_active` (owner-gated) + تسجيلهما + جسر invoke-first/loopback-second | `cargo test` 31/31 + `test:all` 392/392 |
| U-P0-2 | الحسابات الجديدة بلا `must_change_pin` — PIN مُسلَّم يبقى للأبد | `must_change_pin=1` في TS وRust معاً | اختبار `T8b: provisioned accounts start forced-change` |
| U-P0-3 | أخطاء صماء بلا سبب (نفس عائلة #PROD-FAIL) | `lastUserLaneError()` + أسباب مسماة + offline مميز | اختبارا `T8b: typed reasons` و`offline` |

## P1 — عالية (أُغلقت)

| # | المكتشف | الإصلاح |
|---|---|---|
| U-P1-1 | الصفحة لا تجلب عند الفتح | `useEffect` + زر تحديث صريح |
| U-P1-2 | PIN نص مكشوف بلا تأكيد | حقول `password` + `pin/confirmPin` + فحص التطابق |
| U-P1-3 | إنشاء owner ثانٍ بلا احتراز | `window.confirm` صريح AR/FR |
| U-P1-4 | تعطيل بلا تأكيد + إمكانية تعطيل الذات/المالك | تأكيد + تجميد الذات برسالة سبب + مناعة المالك أصلياً |

## P2 — متوسطة (مجدولة)

- U-F1: توثيق المستخدم النهائي ← أُغلق بـ `docs/FIRST-PIN-CHANGE-GUIDE.md`.
- U-F2: إعادة مصادقة PIN قبل الإجراءات المدمرة ← المرحلة B.

## البوابات

`tsc` نظيف + `test:all 392/392` + `cargo test 31/31` + `cargo build` صفر تحذيرات + `npm run build` ناجح. الإثبات الحديدي على المثبت: جلسة ما بعد الإغلاق (RUNBOOK).
