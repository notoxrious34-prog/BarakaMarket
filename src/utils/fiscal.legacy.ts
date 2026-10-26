/**
 * @deprecated QUARANTINED LEGACY FLOAT ENGINE — DO NOT IMPORT.
 * Directive EXEC-DIR-2023-001 TASK 1: monetary monism requires integer
 * centimes (`src/core/fiscal.centimes.ts`). This file is retained for
 * forensic diff only. Any `from '../utils/fiscal'` / `from './fiscal'`
 * import will fail lint review. Use:
 *  - `src/core/cart-bridge.ts`  (calculateLineTotals / calculateSaleTotals)
 *  - `src/core/fiscal.centimes.ts` (calculateLineTotalsCt / calculateTimbreFiscalCt / parseScaleBarcodeCt)
 *  - `src/core/display.ts`      (formatDZD via integer centimes)
 *  - `src/core/legal.ts`        (numberToWordsFR/AR, computeActivationKey)
 */
import { PaymentMethod, SaleItem, StoreProfile, TVABreakdown, TVARate } from '../types';

/**
 * Calculates line HT, TVA, and TTC for an individual sale item.
 * Formula: TTC = HT * (1 + rate/100) => HT = TTC / (1 + rate/100)
 */
export function calculateLineTotals(
  unitPriceTTC: number,
  quantity: number,
  tvaRate: TVARate,
  discountPercent = 0
): {
  total_line_ht: number;
  total_line_tva: number;
  total_line_ttc: number;
} {
  const grossTTC = unitPriceTTC * quantity;
  const discountedTTC = grossTTC * (1 - discountPercent / 100);

  // Rounded to whole centimes/decimals internally
  const rateMultiplier = 1 + tvaRate / 100;
  const lineHT = discountedTTC / rateMultiplier;
  const lineTVA = discountedTTC - lineHT;

  return {
    total_line_ht: Math.round(lineHT * 100) / 100,
    total_line_tva: Math.round(lineTVA * 100) / 100,
    total_line_ttc: Math.round(discountedTTC * 100) / 100,
  };
}

/**
 * Calculates Algerian Droit de Timbre Fiscal (Art. 136 du Code du Timbre).
 * Applies ONLY to cash payments (ESPECES).
 * Standard rate: 1% with minimum (e.g. 10 DZD) and maximum cap (e.g. 2,500 DZD).
 * For non-cash (CIB, Dahabiya, Credit), Timbre is 0 DZD.
 */
export function calculateTimbreFiscal(
  totalTTC: number,
  paymentMethod: PaymentMethod,
  storeProfile?: Partial<StoreProfile>
): number {
  if (paymentMethod !== 'ESPECES') {
    return 0;
  }

  // If sale is small (< 50 DZD), typically no stamp duty applies
  if (totalTTC < 50) {
    return 0;
  }

  const rate = storeProfile?.timbre_rate ?? 0.01; // 1%
  const min = storeProfile?.timbre_min ?? 10;
  const max = storeProfile?.timbre_max ?? 2500;

  let timbre = Math.ceil(totalTTC * rate);
  if (timbre < min) timbre = min;
  if (timbre > max) timbre = max;

  return timbre;
}

/**
 * Calculates entire sale aggregates: Total HT, TVA per tier (0%, 9%, 19%), Timbre, and Total TTC.
 */
export function calculateSaleTotals(
  items: SaleItem[],
  paymentMethod: PaymentMethod,
  storeProfile?: Partial<StoreProfile>
): {
  total_ht: number;
  total_tva: number;
  timbre_fiscal: number;
  total_ttc: number;
  tva_breakdown: Record<TVARate, TVABreakdown>;
} {
  const breakdown: Record<TVARate, TVABreakdown> = {
    0: { rate: 0, base_ht: 0, tva_amount: 0, total_ttc: 0 },
    9: { rate: 9, base_ht: 0, tva_amount: 0, total_ttc: 0 },
    19: { rate: 19, base_ht: 0, tva_amount: 0, total_ttc: 0 },
  };

  let sumHT = 0;
  let sumTVA = 0;
  let sumTTC = 0;

  for (const item of items) {
    const rate = item.tva_rate;
    breakdown[rate].base_ht += item.total_line_ht;
    breakdown[rate].tva_amount += item.total_line_tva;
    breakdown[rate].total_ttc += item.total_line_ttc;

    sumHT += item.total_line_ht;
    sumTVA += item.total_line_tva;
    sumTTC += item.total_line_ttc;
  }

  // Round breakdown amounts to 2 decimals
  for (const rate of [0, 9, 19] as TVARate[]) {
    breakdown[rate].base_ht = Math.round(breakdown[rate].base_ht * 100) / 100;
    breakdown[rate].tva_amount = Math.round(breakdown[rate].tva_amount * 100) / 100;
    breakdown[rate].total_ttc = Math.round(breakdown[rate].total_ttc * 100) / 100;
  }

  sumHT = Math.round(sumHT * 100) / 100;
  sumTVA = Math.round(sumTVA * 100) / 100;
  sumTTC = Math.round(sumTTC * 100) / 100;

  const timbre = calculateTimbreFiscal(sumTTC, paymentMethod, storeProfile);
  // In Algerian practice, final cash payment TTC includes timbre fiscal rounded to exact DZD
  const finalTTC = Math.round(sumTTC + timbre);

  return {
    total_ht: sumHT,
    total_tva: sumTVA,
    timbre_fiscal: timbre,
    total_ttc: finalTTC,
    tva_breakdown: breakdown,
  };
}

/**
 * Format currency in Algerian Dinars (DZD).
 * In supermarkets, whole numbers or 2-decimal notation is used with grouping spaces.
 */
export function formatDZD(amount: number, showDecimals = true): string {
  if (isNaN(amount)) return '0.00 DZD';
  const parts = amount.toFixed(showDecimals ? 2 : 0).split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return showDecimals && parts[1] !== undefined
    ? `${integerPart}.${parts[1]} DZD`
    : `${integerPart} DZD`;
}

/**
 * Smart Barcode Scale Parser (ميزان الباركود الذكي)
 * Format EAN-13 produced by supermarket scales:
 * 20XXXXXWWWWWC -> 20 (Prefix), XXXXX (5-digit Product/PLU Code), WWWWW (Weight in grams), C (Checksum)
 * 22XXXXXPPPPP C -> 22 (Prefix), XXXXX (5-digit Product/PLU Code), PPPPP (Price in centimes/DZD), C (Checksum)
 */
export interface ScaleBarcodeResult {
  isScale: boolean;
  itemCode?: string;
  weightKg?: number;
  priceOverride?: number;
}

export function parseScaleBarcode(rawCode: string): ScaleBarcodeResult {
  const clean = rawCode.trim();
  // Check standard 13-digit scale barcode pattern starting with 20 or 22
  const match = clean.match(/^(20|22)(\d{5})(\d{5})(\d)$/);
  if (!match) {
    return { isScale: false };
  }

  const [, prefix, itemCode, valueStr] = match;
  const numValue = parseInt(valueStr, 10);

  if (prefix === '20') {
    // 20 prefix: value is weight in grams (e.g. 01450 = 1.450 kg)
    const weightKg = Math.round((numValue / 1000) * 1000) / 1000;
    return {
      isScale: true,
      itemCode,
      weightKg,
    };
  } else if (prefix === '22') {
    // 22 prefix: value is price (in whole DZD or centimes)
    return {
      isScale: true,
      itemCode,
      priceOverride: numValue,
    };
  }

  return { isScale: false };
}

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
