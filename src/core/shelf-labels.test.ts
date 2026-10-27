import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEan13Svg, normalizeEan13, ean13BitPattern, ean13CheckDigit } from './barcode-svg.js';
import { generateA4LabelsHtml, generateThermal80mmLabelsEscPos, type ShelfLabelItem } from './shelf-labels.js';

const MILK: ShelfLabelItem = {
  id: 1, barcode: '6130000000015', nameFr: 'Lait Candia 1L', nameAr: 'حليب',
  sellPriceCt: 18000, unit: 'PIECE', tvaRate: 9, category: 'laiterie',
};

// ---- ADR-010-MKT: shelf-edge label engine ----
test('ean13: check digit math (known vector)', () => {
  assert.equal(ean13CheckDigit('613000000001'), 5);
  assert.equal(normalizeEan13('613000000001'), '6130000000015');
  assert.equal(normalizeEan13('6130000000015'), '6130000000015');
});

test('ean13: rejects non-numeric, bad length, bad check digit', () => {
  assert.throws(() => normalizeEan13('61300000000A4'), /numeric/);
  assert.throws(() => normalizeEan13('12345'), /12 or 13/);
  assert.throws(() => normalizeEan13('6130000000016'), /check digit/);
  assert.throws(() => generateEan13Svg('123'), /12 or 13/);
});

test('ean13: 113-module pattern with guards at fixed offsets', () => {
  const bits = ean13BitPattern('6130000000015');
  assert.equal(bits.length, 113);
  assert.equal(bits.slice(0, 9), '000000000');
  assert.equal(bits.slice(9, 12), '101');
  assert.equal(bits.slice(54, 59), '01010');
  assert.equal(bits.slice(101, 104), '101');
  assert.equal(bits.slice(104), '000000000');
});

test('ean13: svg has taller guard rects + human-readable text', () => {
  const svg = generateEan13Svg('6130000000015');
  assert.match(svg, /^<svg viewBox="0 0 \d+ \d+" xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  const heights = [...svg.matchAll(/height="(\d+)"/g)].map(m => Number(m[1]));
  assert.ok(heights.includes(68), 'guard bars taller than 60 data bars');
  assert.ok(heights.includes(60), 'data bars present');
  assert.match(svg, /<text[^>]*>6130000000015<\/text>/);
  const noText = generateEan13Svg('6130000000015', { includeText: false });
  assert.doesNotMatch(noText, /<text/);
});

test('ean13: first-digit parity changes left pattern', () => {
  const a = ean13BitPattern('0613000000128'.slice(0, 12) + '8');
  const b = ean13BitPattern('1613000000125'.slice(0, 12) + '5');
  assert.notEqual(a.slice(12, 54), b.slice(12, 54));
  assert.equal(a.slice(59, 101).length, 42);
});

test('labels: A4 html is a complete printable document', () => {
  const html = generateA4LabelsHtml([MILK], { storeName: 'BARAKA MARKET', printDate: '2026-10-27' });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /@page \{ size: A4 portrait; margin: 8mm; \}/);
  assert.match(html, /grid-template-columns: repeat\(3, 1fr\)/);
  assert.match(html, /Lait Candia 1L/);
  assert.match(html, /<span class="price">180<\/span>/);
  assert.match(html, /<svg viewBox=/);
  assert.match(html, /TVA 9%/);
  assert.match(html, /6130000000015/);
  assert.match(html, /1px dashed #cbd5e1/);
});

test('labels: A4 html escapes names and renders scale code', () => {
  const html = generateA4LabelsHtml([{
    ...MILK, id: 2, nameFr: 'Fromage <affine> & co', isScale: true, scaleCode: '00142', unit: 'KG',
  }]);
  assert.match(html, /Fromage &lt;affine&gt; &amp; co/);
  assert.match(html, /CODE BALANCE: 00142/);
  assert.match(html, /\/kg/);
});

test('labels: thermal buffer opens with INIT, centers, giants price', () => {
  const buf = generateThermal80mmLabelsEscPos([MILK]);
  assert.ok(buf.length > 50);
  assert.equal(buf[0], 0x1b);
  assert.equal(buf[1], 0x40);
  const text = Buffer.from(buf).toString('latin1');
  assert.match(text, /BARAKA MARKET/);
  assert.match(text, /Lait Candia 1L/);
  assert.match(text, /\*\*\* 180\.00 DA \*\*\*/);
  assert.match(text, /TVA: 9% \| Rayon: laiterie/);
  assert.match(text, /6130000000015/);
  assert.match(text, /--------------------------------/);
  assert.equal(buf[buf.length - 4], 0x1d);
  assert.equal(buf[buf.length - 3], 0x56);
});

test('labels: thermal scale item prints balance code line', () => {
  const buf = generateThermal80mmLabelsEscPos([
    { ...MILK, id: 3, barcode: '2000142012501', isScale: true, scaleCode: '00142', unit: 'KG' },
  ]);
  assert.match(Buffer.from(buf).toString('latin1'), /\[CODE BALANCE: 00142\]/);
});

test('labels: thermal strips one block per item', () => {
  const one = generateThermal80mmLabelsEscPos([MILK]);
  const two = generateThermal80mmLabelsEscPos([MILK, { ...MILK, id: 2, barcode: '6130000000021' }]);
  assert.ok(two.length > one.length);
  const count = (Buffer.from(two).toString('latin1').match(/\*\*\*/g) ?? []).length;
  assert.equal(count, 4);
});
