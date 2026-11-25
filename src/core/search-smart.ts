/**
 * ADR-051 P1 — smart catalog matching: Arabic normalization (أ→ا, ة→ه, ى→ي,
 * tashkeel strip) + latin→Arabic transliteration for the common staples
 * (khobz→خبز, hlib→حليب, zit→زيت...) + multi-token AND.
 * Pure — shared by the POS grid filter and the F7 modal.
 */

/** Arabic-letter normalization + latin lowercase, spaces collapsed. */
export function normToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u064B-\u0652\u0670]/g, '') // tashkeel
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Latin query tokens → Arabic (Darija/FR spellings cashiers actually type). */
const LATIN_TO_AR: Record<string, string> = {
  khobz: 'خبز', hobz: 'خبز', pain: 'خبز',
  hlib: 'حليب', halib: 'حليب', lait: 'حليب',
  zit: 'زيت', huile: 'زيت',
  sokkar: 'سكر', soukar: 'سكر', sucre: 'سكر', melh: 'ملح', sel: 'ملح',
  bayd: 'بيض', bid: 'بيض', oeufs: 'بيض', oeuf: 'بيض',
  rouz: 'ارز', riz: 'ارز',
  dgig: 'دقيق', farina: 'فرينه', farine: 'فرينه',
  smid: 'سميد', semoule: 'سميد', couscous: 'كسكس', kaskas: 'كسكس',
  makarona: 'معكرونه', makarouna: 'معكرونه', spaghettis: 'معكرونه',
  tamatim: 'طماطم', tomate: 'طماطم',
  batata: 'بطاطس', pomme: 'تفاح',
  basal: 'بصل', oignon: 'بصل', thoum: 'ثوم', ail: 'ثوم',
  felfel: 'فلفل', poivre: 'فلفل',
  djej: 'دجاج', poulet: 'دجاج', lahm: 'لحم', viande: 'لحم',
  hout: 'سمك', poisson: 'سمك', toun: 'تونه', thon: 'تونه',
  جبن: 'جبن', fromage: 'جبن',
  zebda: 'زبده', beurre: 'زبده',
  qahwa: 'قهوه', kahwa: 'قهوه', cafe: 'قهوه', atay: 'شاي', the: 'شاي',
  ma: 'ماء', eau: 'ماء',
  asir: 'عصير', jus: 'عصير',
  askrim: 'مثلجات', glace: 'مثلجات',
  chocolat: 'شوكولاته', chokola: 'شوكولاته',
  biskit: 'بسكويت', biscuit: 'بسكويت',
  asal: 'عسل', miel: 'عسل',
  sabon: 'صابون', savon: 'صابون', shampoing: 'شامبو',
  kagh: 'ورق', papier: 'ورق',
  tman: 'تمر', dattes: 'تمر',
  adas: 'عدس', loubia: 'فاصوليا', hummus: 'حمص',
  javel: 'جافيل',
};

/** Expand one raw query token into its match variants. */
export function expandToken(tok: string): string[] {
  const n = normToken(tok);
  if (!n) return [];
  if (/[\u0600-\u06FF]/.test(n)) return [n];
  const ar = LATIN_TO_AR[n];
  return ar ? [n, normToken(ar)] : [n];
}

export interface SearchableLike {
  name_fr: string;
  name_ar: string;
  barcode: string;
}

/** AND over tokens; each token matches FR, AR (via transliteration), or barcode. */
export function smartMatches(p: SearchableLike, rawQuery: string): boolean {
  const tokens = rawQuery.split(/\s+/).map(normToken).filter(Boolean);
  if (tokens.length === 0) return true;
  const hayFr = normToken(p.name_fr);
  const hayAr = normToken(p.name_ar);
  return tokens.every(tok =>
    expandToken(tok).some(v =>
      hayFr.includes(v) || hayAr.includes(v) || p.barcode.toLowerCase().includes(v),
    ),
  );
}
