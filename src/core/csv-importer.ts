/**
 * Baraka Market — bulk CSV catalog importer (zero dependencies).
 * - Auto-detects `;` (Algerian/French supplier lists) vs `,` delimiters.
 * - RFC-4180-ish quotes: embedded delimiters, doubled quotes, CRLF/newlines
 *   inside quoted fields.
 * - Header aliasing FR/EN; Dinars -> integer centimes; quantities ->
 *   integer milli-units; TVA gate 0|9|19.
 * - Pure: no fs, no DB. The DAL batch commit lives in `db/sqlite.ts`.
 *
 * @module core/csv-importer
 */
import { dzdToCentimes } from './money.js';

export type ImportUnit = 'PIECE' | 'KG' | 'LITRE';
export type ImportTva = 0 | 9 | 19;

export interface ParsedProductRow {
  row: number;
  barcode: string;
  name_fr: string;
  name_ar: string;
  buyPriceCt: number;
  priceCt: number;
  tvaRate: ImportTva;
  stockMilli: number;
  category: string;
  unit: ImportUnit;
}

export interface RowError {
  row: number;
  field: string;
  message: string;
}

export interface ImportSummary {
  total: number;
  valid: number;
  errorsCount: number;
}

export interface PreflightReport {
  validRows: ParsedProductRow[];
  errors: RowError[];
  summary: ImportSummary;
}

const HEADER_ALIASES: Record<string, string> = {
  barcode: 'barcode', code_barre: 'barcode', cb: 'barcode', ean: 'barcode',
  name: 'name', designation: 'name', nom: 'name', produit: 'name',
  name_fr: 'name_fr', name_ar: 'name_ar',
  buy_price: 'buy', prix_achat: 'buy', pa: 'buy', cout: 'buy',
  price: 'sell', sell_price: 'sell', prix_vente: 'sell', pv: 'sell', prix: 'sell',
  tva: 'tva', tva_rate: 'tva', taxe: 'tva',
  stock: 'stock', quantite: 'stock', qte: 'stock',
  unit: 'unit', unite: 'unit',
  category: 'category', famille: 'category', rayon: 'category',
};

const UNIT_ALIASES: Record<string, ImportUnit> = {
  piece: 'PIECE', pcs: 'PIECE', u: 'PIECE', unite: 'PIECE', unit: 'PIECE',
  kg: 'KG', kilo: 'KG', kilogramme: 'KG',
  litre: 'LITRE', liter: 'LITRE', l: 'LITRE',
};

/** Inspect the first non-empty line: more `;` than `,` -> semicolon. */
export function detectDelimiter(csvText: string): ';' | ',' {
  const first = csvText.split('\n').find(l => l.trim().length > 0) ?? '';
  let semi = 0, comma = 0, inQ = false;
  for (const ch of first) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch === ';') semi += 1;
    else if (!inQ && ch === ',') comma += 1;
  }
  return semi >= comma && semi > 0 ? ';' : ',';
}

/** Split CSV text into rows of fields (quotes, doubled quotes, CRLF safe). */
export function splitCsvRows(csvText: string, delimiter: ';' | ','): string[][] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], inQ = false;
  const text = csvText.replace(/\r\n/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

function toNumberFr(raw: string, delimiter: ';' | ','): number {
  const s = (delimiter === ';' ? raw.replace(/,/g, '.') : raw).trim().replace(/%$/, '').trim();
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Preflight dry-run: parse + validate without touching the DB.
 * Row numbers are 1-based file lines (header = 1).
 */
export function preflightCsv(csvText: string): PreflightReport {
  const errors: RowError[] = [];
  const validRows: ParsedProductRow[] = [];
  if (!csvText.trim()) {
    return { validRows, errors, summary: { total: 0, valid: 0, errorsCount: 0 } };
  }
  const delimiter = detectDelimiter(csvText);
  const rows = splitCsvRows(csvText, delimiter);
  const headers = rows[0].map(h => {
    const key = h.trim().toLowerCase();
    return HEADER_ALIASES[key] ?? '';
  });
  const col = (name: string): number => headers.indexOf(name);
  const iBarcode = col('barcode'), iName = col('name'), iNameFr = col('name_fr'),
    iNameAr = col('name_ar'), iBuy = col('buy'), iSell = col('sell'),
    iTva = col('tva'), iStock = col('stock'), iUnit = col('unit'), iCat = col('category');

  if (iBarcode < 0) {
    errors.push({ row: 1, field: 'barcode', message: 'Missing barcode column (barcode|code_barre|cb|ean)' });
    return { validRows, errors, summary: { total: rows.length - 1, valid: 0, errorsCount: errors.length } };
  }

  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const lineNo = r + 1;
    const cells = rows[r];
    const get = (i: number): string => (i >= 0 && i < cells.length ? cells[i].trim() : '');
    const rowErrors: RowError[] = [];
    const err = (field: string, message: string) => rowErrors.push({ row: lineNo, field, message });

    const barcode = get(iBarcode);
    if (!barcode) err('barcode', 'Barcode must not be empty');
    else if (seen.has(barcode)) err('barcode', `Duplicate barcode in file: ${barcode}`);
    else seen.add(barcode);

    const nameFr = iNameFr >= 0 ? get(iNameFr) : get(iName);
    const nameAr = iNameAr >= 0 ? get(iNameAr) : '';
    if (!nameFr) err('name', 'Name must not be empty');

    const buyRaw = get(iBuy), sellRaw = get(iSell);
    const buyNum = buyRaw === '' ? 0 : toNumberFr(buyRaw, delimiter);
    const sellNum = sellRaw === '' ? NaN : toNumberFr(sellRaw, delimiter);
    if (buyRaw !== '' && (!Number.isFinite(buyNum) || buyNum < 0)) err('buy_price', `Invalid buy price: ${buyRaw}`);
    if (!Number.isFinite(sellNum) || sellNum < 0) err('price', `Invalid sell price: ${sellRaw}`);

    let tvaRate: ImportTva = 0;
    const tvaRaw = get(iTva);
    if (tvaRaw !== '') {
      const t = toNumberFr(tvaRaw, delimiter);
      if (t !== 0 && t !== 9 && t !== 19) err('tva', 'TVA must be 0, 9, or 19');
      else tvaRate = t as ImportTva;
    }

    const stockRaw = get(iStock);
    const stockNum = stockRaw === '' ? 0 : toNumberFr(stockRaw, delimiter);
    if (!Number.isFinite(stockNum) || stockNum < 0) err('stock', `Invalid stock: ${stockRaw}`);

    let unit: ImportUnit = 'PIECE';
    const unitRaw = get(iUnit).toLowerCase();
    if (unitRaw !== '') {
      const mapped = UNIT_ALIASES[unitRaw];
      if (!mapped) err('unit', `Unit must be PIECE, KG or LITRE (got ${get(iUnit)})`);
      else unit = mapped;
    }

    if (rowErrors.length > 0) { errors.push(...rowErrors); continue; }
    validRows.push({
      row: lineNo,
      barcode,
      name_fr: nameFr,
      name_ar: nameAr,
      buyPriceCt: dzdToCentimes(buyNum),
      priceCt: dzdToCentimes(sellNum),
      tvaRate,
      stockMilli: Math.round(stockNum * 1000),
      category: get(iCat) || 'Général',
      unit,
    });
  }
  return { validRows, errors, summary: { total: rows.length - 1, valid: validRows.length, errorsCount: errors.length } };
}
