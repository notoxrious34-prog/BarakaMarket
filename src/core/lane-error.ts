/**
 * lane-error.ts — P0 (ADR-044 §4.3-1, AUDIT-2026-11-11 §3).
 *
 * Single institution-grade translator: raw lane/transport refusal
 * → cashier-facing guidance (AR/FR). The lane decides, the view translates.
 *
 * Rules (first match wins, case-insensitive):
 *  - Transport / session guards (token, CASH_LANE_DOWN, unreachable)
 *  - Fiscal guards (locked day, open session, manager-only, self-approval…)
 *  - Domain refusals (returns windows, remaining qty, drawer short…)
 *  - Fallback keeps the RAW string for forensics (never swallowed).
 *
 * Pure + fully tested. Replaces the three hand-grown mappers in
 * ReturnsView / SalesBookView / CashSessionsView (identical strings).
 */

export interface LaneRule {
  match: RegExp;
  ar: string | ((raw: string) => string);
  fr: string | ((raw: string) => string);
}

const pick = (v: string | ((raw: string) => string), raw: string) =>
  typeof v === 'function' ? v(raw) : v;

const RULES: LaneRule[] = [
  // — Transport / session guards (highest priority: explain the lane first) —
  { match: /loopback token|401|session sans droit|sans droit d'écriture/i,
    ar: 'تعذّر تسجيل الطبع: هذه الجلسة بلا تصريح كتابة — الطبع المحوكم في نسخة الصندوق المثبتة.',
    fr: 'Enregistrement impossible : session sans droit d’écriture — duplicata réservé à la caisse installée.' },
  { match: /cash_lane_down/i,
    ar: 'الصندوق غير متصل هنا — تُدار الجلسات من نسخة الصندوق المثبتة.',
    fr: 'Caisse injoignable ici — sessions gérées depuis la caisse installée.' },
  { match: /unreachable|base injoignable|failed to fetch|network|error sending request/i,
    ar: 'تعذّر الاتصال — تحقق من الشبكة ثم أعد المحاولة، أو ثبّت عبر USB.',
    fr: 'Connexion impossible — vérifiez le réseau puis réessayez, ou installez via USB.' },
  // — Fiscal guards —
  { match: /locked|clôtur/i,
    ar: 'اليوم الجبائي مغلق', fr: 'Journée fiscale clôturée' },
  { match: /open cash session/i,
    ar: 'افتح جلسة صندوق أولاً', fr: 'Ouvrez une session de caisse' },
  { match: /manager or owner/i,
    ar: 'القرار للمدير/المالك فقط', fr: 'Décision manager/propriétaire uniquement' },
  { match: /second person|self-approv/i,
    ar: 'مبلغ ≥ 5000 دج: يلزم مُعتمِد ثانٍ (غير منشئ المسودة)', fr: '≥ 5000 DA : second approbateur requis' },
  { match: /already decided/i,
    ar: 'حُسم هذا الإرجاع مسبقاً', fr: 'Retour déjà traité' },
  // — Returns domain —
  { match: /not found/i,
    ar: 'غير موجود — تحقق من الرقم', fr: 'Introuvable — vérifiez le numéro' },
  { match: /window/i,
    ar: 'انتهت مهلة 7 أيام', fr: 'Délai de 7 jours dépassé' },
  { match: /exceeds remaining|remaining/i,
    ar: 'الكمية تتجاوز المتبقي القابل للإرجاع', fr: 'Quantité supérieure au reliquat' },
  { match: /needs a note/i,
    ar: 'سبب «أخرى» يتطلب ملاحظة تشرح العيب', fr: 'Motif «Autre» : note explicative requise' },
  { match: /drawer short/i,
    ar: (raw) => {
      const nums = raw.match(/\d+/g)?.map(Number) ?? [];
      const fmt = (n: number) => (n / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' DZD';
      const detail = nums.length >= 2 ? ` (الدرج: ${fmt(nums[0])} · المطلوب: ${fmt(nums[1])})` : '';
      return `الدرج لا يكفي لهذا الاسترداد${detail}`;
    },
    fr: (raw) => {
      const nums = raw.match(/\d+/g)?.map(Number) ?? [];
      const fmt = (n: number) => (n / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' DZD';
      const detail = nums.length >= 2 ? ` (Tiroir: ${fmt(nums[0])} · Requis: ${fmt(nums[1])})` : '';
      return `Fond insuffisant pour ce remboursement${detail}`;
    } },
  { match: /not completed|cancelled/i,
    ar: 'الفاتورة ملغاة/غير مكتملة — ليست للإرجاع', fr: 'Facture annulée — hors retour' },
];

/**
 * Translate a raw lane refusal into a cashier-facing sentence.
 * Empty raw → explicit "unspecified" message (never blank, never throws).
 */
export function friendlyLaneError(raw: string | null | undefined, isAr: boolean): string {
  const r = (raw ?? '').trim();
  if (!r) return isAr ? 'رفض غير معلن — راجع السجل' : 'Refus non précisé — voir audit';
  for (const rule of RULES) {
    if (rule.match.test(r)) {
      return isAr ? pick(rule.ar, r) : pick(rule.fr, r);
    }
  }
  return isAr ? `رفض: ${r}` : `Refus : ${r}`;
}
