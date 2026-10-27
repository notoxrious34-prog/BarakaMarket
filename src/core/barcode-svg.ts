/**
 * Baraka Market — zero-dependency EAN-13 vector barcode generator (GS1).
 * L/G/R parity patterns, start/center/end guard bars, quiet zones.
 * Pure: no fs, no DOM, no npm packages.
 *
 * @module core/barcode-svg
 */

const L_SET = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G_SET = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R_SET = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];

/** First-digit -> parity of the 6 left digits (L/G). Right side is always R. */
const PARITY: Record<string, Array<'L' | 'G'>> = {
  '0': ['L', 'L', 'L', 'L', 'L', 'L'],
  '1': ['L', 'L', 'G', 'L', 'G', 'G'],
  '2': ['L', 'L', 'G', 'G', 'L', 'G'],
  '3': ['L', 'L', 'G', 'G', 'G', 'L'],
  '4': ['L', 'G', 'L', 'L', 'G', 'G'],
  '5': ['L', 'G', 'G', 'L', 'L', 'G'],
  '6': ['L', 'G', 'G', 'G', 'L', 'L'],
  '7': ['L', 'G', 'L', 'G', 'L', 'G'],
  '8': ['L', 'G', 'L', 'G', 'G', 'L'],
  '9': ['L', 'G', 'G', 'L', 'G', 'L'],
};

/** GS1 modulo-10 check digit over the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(first12[i], 10) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * Normalize input: 12 digits -> appends check digit; 13 digits -> verifies it.
 * Throws on anything else (non-numeric, wrong length, bad check digit).
 */
export function normalizeEan13(barcode: string): string {
  const code = barcode.trim();
  if (code.length !== 12 && code.length !== 13) {
    throw new Error(`[ean13] expected 12 or 13 digits (got ${code.length})`);
  }
  let allDigits = true;
  for (const ch of code) if (ch < '0' || ch > '9') { allDigits = false; break; }
  if (!allDigits) throw new Error('[ean13] barcode must be numeric');
  if (code.length === 12) return code + String(ean13CheckDigit(code));
  const expect = ean13CheckDigit(code.slice(0, 12));
  if (parseInt(code[12], 10) !== expect) {
    throw new Error(`[ean13] bad check digit (expected ${expect})`);
  }
  return code;
}

export interface Ean13SvgOptions {
  moduleWidth?: number;
  height?: number;
  includeText?: boolean;
}

/**
 * Full 95-module bit pattern (quiet + start + 6L + center + 6R + end + quiet).
 * Exported for tests: guards at fixed offsets.
 */
export function ean13BitPattern(ean13: string): string {
  const parity = PARITY[ean13[0]];
  let left = '';
  for (let i = 0; i < 6; i++) {
    const d = parseInt(ean13[i + 1], 10);
    left += (parity[i] === 'L' ? L_SET : G_SET)[d];
  }
  let right = '';
  for (let i = 0; i < 6; i++) right += R_SET[parseInt(ean13[i + 7], 10)];
  return '000000000' + '101' + left + '01010' + right + '101' + '000000000';
}

export function generateEan13Svg(barcode: string, options?: Ean13SvgOptions): string {
  const ean13 = normalizeEan13(barcode);
  const mw = options?.moduleWidth ?? 2;
  const h = options?.height ?? 60;
  const guardExtra = 8;
  const bits = ean13BitPattern(ean13);
  const width = bits.length * mw;
  // Merge runs of black modules into single rects; guards run taller.
  const isGuard = (i: number): boolean =>
    (i >= 9 && i < 12) || (i >= 54 && i < 59) || (i >= 101 && i < 104);
  let rects = '';
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let j = i;
      while (j < bits.length && bits[j] === '1' && isGuard(j) === isGuard(i)) j += 1;
      const tall = isGuard(i);
      rects += `<rect x="${i * mw}" y="0" width="${(j - i) * mw}" height="${tall ? h + guardExtra : h}"/>`;
      i = j;
    } else i += 1;
  }
  const text = options?.includeText === false ? '' :
    `<text x="${width / 2}" y="${h + guardExtra + 14}" text-anchor="middle" font-family="monospace" font-size="14">${ean13}</text>`;
  const vbH = h + guardExtra + (options?.includeText === false ? 0 : 18);
  return `<svg viewBox="0 0 ${width} ${vbH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="EAN-13 ${ean13}"><g fill="black">${rects}</g>${text}</svg>`;
}
