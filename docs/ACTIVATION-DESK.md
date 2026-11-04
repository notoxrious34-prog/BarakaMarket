# مكتب التفعيل — Baraka Activation Desk v3 (للطاقم فقط)

> القاعدة الذهبية: **المفتاح الخاص لا يغادر جهاز المالك أبداً.**
> الأداة توقّع هنا فقط. العميل يتحقق بالمفتاح العام المضمن ولا يمكنه التزوير.

## التشغيل

| الطريقة | الأمر |
|---|---|
| نقرة مزدوجة (الأسهل) | `BarakaActivationDesk.exe` ← قائمة موجهة 1-5 |
| سطر أوامر | `npm run keygen -- generate --store "Epicerie Nour" --hwid BM-…` |
| سكربت/SSH | نفس الأمر + `--yes --json` (مخرجات JSON، رموز خروج 0/2/3) |

## الأوامر

- `generate --store "S" --hwid H [--yes] [--json] [--key-file p.pem]` — يطبّع الاسم،
  يطلب تأكيد `yes` قبل التوقيع، يتحقق ذاتياً، يطبع الإيصال + سطر الواتساب، ويسجل في الدفتر.
- `verify --store S --hwid H --key AK-…` — يقبل HWID بأي شكل بشري (صغيرة/بلا شرطات).
- `hwid [--json]` — بصمة هذا الجهاز (للدعم الهاتفي: «اقرأ لي ما يظهر»).
- `ledger [--verify] [--csv] [--last N] [--revoke SEQ]` — الدفتر.
- `version` / bare — المساعدة (أو القائمة في الطرفية).

## الدفتر (keygen-ledger.jsonl)

- كل إصدار = سطر JSON برقم متسلسل + `hash = sha256(prev|…)` — أي تعديل يدوي
  يُكتشف بـ `ledger --verify` (يذكر رقم أول سطر مكسور).
- `ledger --csv` للمحاسبة: كل إصدار = `5000 DZD` (سعر الإعلام، تفرضه سياسة البيع).
- `ledger --revoke N` يضيف علامة إلغاء **مرجعية للطاقم فقط** — عملاء الشحن
  يتحققون دون اتصال، فالمفتاح الملغي يُعامل كمسروق: دوّن محلاً جديداً بـ HWID جديد.
- الدفتر بجانب الـ exe (لا في المستودع). انسخه احتياطياً مع النسخ الساخنة.

## مراسم المفتاح (صارمة)

1. الإنتاج `Ed25519` مولّد دون اتصال؛ الخاص في `.baraka-privkey.pem` بجانب الـ exe
   (أو `BARAKA_PRIVATE_KEY`) — **لا Commit، لا بريد، لا USB مشترك**.
2. التدوير: ولّد زوجاً جديداً → ابنِ عميلاً يحمل العام الجديد → فعّل المحلات
   بالمفاتيح الجديدة → أتلف القديم. لا يوجد إلغاء عن بُعد (تصميم دون اتصال).
3. أي `SELF-CHECK FAILED` = توقف فوري وإبلاغ — لا توزع مفتاحاً لم يتحقق ذاتياً.

## استكشاف

| العرض | المعنى |
|---|---|
| `Missing private key` | ضع الـ PEM بجانب الـ exe أو مرر `--key-file` |
| `Invalid HWID` | الصق ما يظهر في محل الزبون حرفياً (القائمة `4)` تقرأ بصمة جهازك أنت) |
| `VERIFY: INVALID` | اسم المحل يجب أن يطابق المسجل (التطبيع: تقليم + أحرف كبيرة) |
| `LEDGER: TAMPERED` | الدفتر عُدّل يدوياً — راجع النسخة الاحتياطية قبل أي إصدار جديد |
| خروج `2` / `3` | استخدام/إدخال مقابل تشفير-رفض — السكربتات تفرّق بهما |

## البناء (STAFF)

```sh
npx esbuild scripts/activation-desk.ts --bundle --platform=node --format=cjs --outfile=.tmp-sea/desk.cjs
echo '{"main":".tmp-sea/desk.cjs","output":".tmp-sea/sea-prep.blob"}' > .tmp-sea/sea-config.json
# قاعدة غير موقعة (الموقعة يرفضها postject): Node محمول في D:/tools/node-sea/
cp D:/tools/node-sea/node.exe .tmp-sea/BarakaActivationDesk.exe
D:/tools/node-sea/node.exe --experimental-sea-config .tmp-sea/sea-config.json
npx --yes postject .tmp-sea/BarakaActivationDesk.exe NODE_SEA_BLOB .tmp-sea/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

> الـ fuse القديم المنتشر (`…4047586`) **ميت** — استخرج الصحيح من الثنائية:
> `grep -a -o "NODE_SEA_FUSE_[A-Za-z0-9]*" node.exe`. الحقن يفشل بدونه
> (`Could not find the sentinel`) رغم وجود السلسلة الجزئية.

التوافق مضمون: صيغة `AK-` + 86 حرفاً لم تتغير — كل المفاتيح القديمة تبقى صالحة.
