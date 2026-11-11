import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyLaneError } from './lane-error';

// P0 regression corpus (ADR-044 §4.3-1): every pre-existing lane message
// keeps its EXACT cashier-facing string after unification (AR + FR).
const CORPUS: Array<[string, string, string]> = [
  ['loopback token required', 'تعذّر تسجيل الطبع: هذه الجلسة بلا تصريح كتابة — الطبع المحوكم في نسخة الصندوق المثبتة.', 'Enregistrement impossible : session sans droit d’écriture — duplicata réservé à la caisse installée.'],
  ['CASH_LANE_DOWN', 'الصندوق غير متصل هنا — تُدار الجلسات من نسخة الصندوق المثبتة.', 'Caisse injoignable ici — sessions gérées depuis la caisse installée.'],
  ['day locked', 'اليوم الجبائي مغلق', 'Journée fiscale clôturée'],
  ['open cash session required', 'افتح جلسة صندوق أولاً', 'Ouvrez une session de caisse'],
  ['manager or owner only', 'القرار للمدير/المالك فقط', 'Décision manager/propriétaire uniquement'],
  ['second person required', 'مبلغ ≥ 5000 دج: يلزم مُعتمِد ثانٍ (غير منشئ المسودة)', '≥ 5000 DA : second approbateur requis'],
  ['already decided', 'حُسم هذا الإرجاع مسبقاً', 'Retour déjà traité'],
  ['sale not found', 'غير موجود — تحقق من الرقم', 'Introuvable — vérifiez le numéro'],
  ['outside window', 'انتهت مهلة 7 أيام', 'Délai de 7 jours dépassé'],
  ['exceeds remaining 2000', 'الكمية تتجاوز المتبقي القابل للإرجاع', 'Quantité supérieure au reliquat'],
  ['needs a note', 'سبب «أخرى» يتطلب ملاحظة تشرح العيب', 'Motif «Autre» : note explicative requise'],
  ['not completed', 'الفاتورة ملغاة/غير مكتملة — ليست للإرجاع', 'Facture annulée — hors retour'],
];

describe('lane-error (P0 unification)', () => {
  it('preserves every legacy message exactly (AR + FR)', () => {
    for (const [raw, ar, fr] of CORPUS) {
      assert.equal(friendlyLaneError(raw, true), ar, `AR: ${raw}`);
      assert.equal(friendlyLaneError(raw, false), fr, `FR: ${raw}`);
    }
  });
  it('network failures guide to retry/USB (never raw English)', () => {
    for (const raw of ['error sending request', 'Failed to fetch', 'NetworkError']) {
      assert.match(friendlyLaneError(raw, true), /USB/);
      assert.match(friendlyLaneError(raw, false), /USB/);
    }
  });
  it('empty raw is explicit, fallback keeps raw for forensics', () => {
    assert.match(friendlyLaneError('', true), /راجع السجل/);
    assert.match(friendlyLaneError(null, false), /voir audit/);
    assert.equal(friendlyLaneError('weird_NEW_case 42', true), 'رفض: weird_NEW_case 42');
    assert.equal(friendlyLaneError('weird_NEW_case 42', false), 'Refus : weird_NEW_case 42');
  });
  it('drawer-short interpolates drawer/required amounts', () => {
    assert.match(friendlyLaneError('drawer short 100000 18000', true), /الدرج/);
    assert.match(friendlyLaneError('drawer short 100000 18000', false), /Tiroir/);
  });
});
