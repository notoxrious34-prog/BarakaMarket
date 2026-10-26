/**
 * Baraka Market — Legal text + offline license helpers (no money math).
 * Extracted verbatim from legacy `utils/fiscal.ts` so the deprecated
 * float engine can be quarantined with zero importers.
 * These functions operate on integers/strings only — safe for fiscal use.
 *
 * @module core/legal
 */

/**
 * French words conversion for Algerian commercial invoices (Arrêté de facture).
 */
export function numberToWordsFR(num: number): string {
  const integerPart = Math.floor(Math.abs(num));
  if (integerPart === 0) return 'Zéro Dinar';

  const ones = [
    '', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf',
    'Dix', 'Onze', 'Douze', 'Treize', 'Quatorze', 'Quinze', 'Seize', 'Dix-Sept', 'Dix-Huit', 'Dix-Neuf',
  ];
  const tens = [
    '', '', 'Vingt', 'Trente', 'Quarante', 'Cinquante', 'Soixante', 'Soixante-Dix', 'Quatre-Vingt', 'Quatre-Vingt-Dix',
  ];

  function convertBelow1000(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ones[n];

    if (n < 100) {
      const ten = Math.floor(n / 10);
      const rest = n % 10;
      if (ten === 7) return `Soixante-${ones[10 + rest]}`;
      if (ten === 9) return `Quatre-Vingt-${ones[10 + rest]}`;
      if (rest === 1 && ten !== 8) return `${tens[ten]} et Un`;
      return `${tens[ten]}${rest ? '-' + ones[rest] : ''}`;
    }

    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    const hundredStr = hundred === 1 ? 'Cent' : `${ones[hundred]} Cent`;
    return rest ? `${hundredStr} ${convertBelow1000(rest)}` : hundredStr;
  }

  let result = '';
  const millions = Math.floor(integerPart / 1_000_000);
  const thousands = Math.floor((integerPart % 1_000_000) / 1_000);
  const remainder = integerPart % 1_000;

  if (millions > 0) {
    result += (millions === 1 ? 'Un Million ' : `${convertBelow1000(millions)} Millions `);
  }
  if (thousands > 0) {
    result += (thousands === 1 ? 'Mille ' : `${convertBelow1000(thousands)} Mille `);
  }
  if (remainder > 0 || result === '') {
    result += convertBelow1000(remainder);
  }

  return `${result.trim()} Dinars Algériens`;
}

/**
 * Arabic words conversion for Algerian commercial invoices.
 */
export function numberToWordsAR(num: number): string {
  const integerPart = Math.floor(Math.abs(num));
  if (integerPart === 0) return 'صفر دينار جزائري';

  const units = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
  const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function convertChunk(n: number): string {
    if (n === 0) return '';
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;
    const parts: string[] = [];

    if (h > 0) parts.push(hundreds[h]);

    if (t === 1) {
      parts.push(teens[u]);
    } else {
      if (u > 0) parts.push(units[u]);
      if (t > 1) parts.push(tens[t]);
    }

    return parts.join(' و ');
  }

  const millions = Math.floor(integerPart / 1_000_000);
  const thousands = Math.floor((integerPart % 1_000_000) / 1_000);
  const rem = integerPart % 1_000;

  const chunks: string[] = [];

  if (millions > 0) {
    if (millions === 1) chunks.push('مليون');
    else if (millions === 2) chunks.push('مليونان');
    else chunks.push(`${convertChunk(millions)} مليون`);
  }

  if (thousands > 0) {
    if (thousands === 1) chunks.push('ألف');
    else if (thousands === 2) chunks.push('ألفان');
    else if (thousands >= 3 && thousands <= 10) chunks.push(`${convertChunk(thousands)} آلاف`);
    else chunks.push(`${convertChunk(thousands)} ألف`);
  }

  if (rem > 0) {
    chunks.push(convertChunk(rem));
  }

  return `${chunks.join(' و ')} دينار جزائري`;
}

/**
 * Offline License & Hardware ID generator for Baraka Market by BarakaDEV.
 * Price: 5,000 DZD perpetual offline activation.
 */
export function generateMachineHardwareId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hwid = 'BM-';
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      hwid += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (i < 3) hwid += '-';
  }
  return hwid;
}

export function computeActivationKey(hardwareId: string): string {
  // Deterministic hash transformation for BarakaDEV keygen
  let hash = 0x811c9dc5;
  for (let i = 0; i < hardwareId.length; i++) {
    hash ^= hardwareId.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
  return `KEY-${hex.slice(0, 4)}-${hex.slice(4, 8)}-BARAKA`;
}
