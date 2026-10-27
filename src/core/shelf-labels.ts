/**
 * Baraka Market — shelf-edge label engine (Étiquettes de gondole, DCP-ready).
 * Format A: A4 perforated sheets (3 x 8, 65 x 38 mm) with vector SVG barcodes.
 * Format B: 80mm thermal receipt-printer strips (ESC/POS byte buffer).
 * Pure + zero-dep (except the SVG generator + centimes formatter).
 *
 * @module core/shelf-labels
 */
import { generateEan13Svg } from './barcode-svg.js';

export interface ShelfLabelItem {
  id: number;
  barcode: string;
  nameFr: string;
  nameAr?: string;
  sellPriceCt: number;
  unit: 'PIECE' | 'KG' | 'LITRE';
  isScale?: boolean;
  scaleCode?: string;
  tvaRate: 0 | 9 | 19;
  category?: string;
}

export interface A4LabelOptions {
  storeName?: string;
  printDate?: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fold diacritics to 7-bit so thermal output stays deterministic. */
const foldLatin = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const priceLabel = (sellPriceCt: number): string => {
  const dzd = sellPriceCt / 100;
  return Number.isInteger(dzd) ? String(dzd) : dzd.toFixed(2);
};

/**
 * Standalone A4 page: 3-column grid, 65x38mm cards, dashed cut borders,
 * inline vector SVG per label.
 */
export function generateA4LabelsHtml(items: ShelfLabelItem[], options?: A4LabelOptions): string {
  const store = esc(options?.storeName ?? 'BARAKA MARKET');
  const date = esc(options?.printDate ?? new Date().toISOString().slice(0, 10));
  const cards = items.map(it => {
    const svg = generateEan13Svg(it.barcode);
    const unitSuffix = it.unit === 'KG' ? ' /kg' : it.unit === 'LITRE' ? ' /L' : '';
    const scaleLine = it.isScale && it.scaleCode
      ? `<div class="scale">CODE BALANCE: ${esc(it.scaleCode)}</div>` : '';
    return `<div class="label">
      <div class="top"><span class="store">${store}</span><span class="tva">TVA ${it.tvaRate}%</span></div>
      <div class="name">${esc(it.nameFr)}${it.nameAr ? ` <span class="ar">${esc(it.nameAr)}</span>` : ''}</div>
      <div class="price-row"><span class="price">${priceLabel(it.sellPriceCt)}</span><span class="currency">DA${unitSuffix}</span></div>
      <div class="barcode">${svg}</div>
      <div class="code">${esc(it.barcode)}</div>
      ${scaleLine}
      <div class="foot">${date}${it.category ? ` • ${esc(it.category)}` : ''}</div>
    </div>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Etiquettes rayon — ${store}</title>
<style>
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; }
.sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
.label { width: 65mm; height: 38mm; border: 1px dashed #cbd5e1; padding: 2mm;
  display: flex; flex-direction: column; page-break-inside: avoid; overflow: hidden; }
.top { display: flex; justify-content: space-between; align-items: center; }
.store { font-size: 7pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
.tva { font-size: 6.5pt; font-weight: bold; border: 1px solid #333; padding: 0 2px; }
.name { font-size: 9pt; font-weight: bold; line-height: 1.1; margin: 1mm 0;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.name .ar { font-weight: normal; }
.price-row { margin-top: auto; }
.price { font-size: 22pt; font-weight: 900; }
.currency { font-size: 11pt; font-weight: bold; margin-left: 1mm; }
.barcode svg { width: 100%; height: 9mm; display: block; }
.code { font-size: 7pt; font-family: monospace; text-align: center; letter-spacing: 2px; }
.scale { font-size: 7pt; font-weight: bold; text-align: center; }
.foot { font-size: 6pt; color: #555; text-align: right; }
@media print { .label { border-style: dashed; } }
</style></head>
<body><div class="sheet">
${cards}
</div></body></html>`;
}

const ESC = 0x1b, LF = 0x0a;
const textBytes = (s: string): number[] => Array.from(new TextEncoder().encode(foldLatin(s)));

/**
 * 80mm thermal strip buffer: centered bold store, double-width name,
 * giant price (ESC ! 48), TVA/category line, barcode digits + scale code,
 * dashed scissor line + feed per label, partial cut at the end.
 */
export function generateThermal80mmLabelsEscPos(items: ShelfLabelItem[], storeName = 'BARAKA MARKET'): Uint8Array {
  const out: number[] = [];
  const line = (s = ''): void => { out.push(...textBytes(s), LF); };
  const sep32 = '-'.repeat(32);
  const scissor = '- - - - - - - - - - - - - - - -';
  for (const it of items) {
    out.push(ESC, 0x40);
    out.push(ESC, 0x61, 0x01);
    out.push(ESC, 0x45, 0x01);
    line(foldLatin(storeName));
    out.push(ESC, 0x45, 0x00);
    out.push(ESC, 0x21, 32);
    line(it.nameFr);
    out.push(ESC, 0x21, 0);
    out.push(ESC, 0x21, 48);
    out.push(ESC, 0x45, 0x01);
    line(`*** ${(it.sellPriceCt / 100).toFixed(2)} DA ***`);
    out.push(ESC, 0x45, 0x00);
    out.push(ESC, 0x21, 0);
    line(`TVA: ${it.tvaRate}% | Rayon: ${it.category ?? 'General'}`);
    line(it.barcode);
    if (it.isScale && it.scaleCode) line(`[CODE BALANCE: ${it.scaleCode}]`);
    line(sep32);
    line(`<< ${scissor} >>`);
    out.push(ESC, 0x64, 2);
  }
  out.push(0x1d, 0x56, 0x42, 0x00);
  return new Uint8Array(out);
}
