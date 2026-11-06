/**
 * Baraka Market — stock CSV exporter (mirrors core/csv-importer).
 * - Canonical FR headers the importer aliases back (`barcode;name_fr;name_ar;
 *   buy_price;sell_price;tva;stock;unit;category`).
 * - `;` delimiter + UTF-8 BOM (Excel opens Arabic + decimals correctly).
 * - RFC-4180 quoting only when needed; DZD decimals with `.` (round-trip safe
 *   through `toNumberFr`); stock with up to 3 decimals (milli-units exact).
 *
 * @module core/csv-exporter
 */
import type { Product } from '../types/index.js';

export const STOCK_CSV_HEADERS =
  'barcode;name_fr;name_ar;buy_price;sell_price;tva;stock;unit;category';

function cell(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function dzd(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

function qty(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(r);
}

export interface StockCsvOptions {
  /** Export only these products (default: all). */
  only?: Product[];
}

/** Build the full CSV text (BOM included) for the given catalog. */
export function buildStockCsv(products: Product[], opts: StockCsvOptions = {}): string {
  const list = opts.only ?? products;
  const lines = [STOCK_CSV_HEADERS];
  for (const p of list) {
    lines.push([
      cell(p.barcode),
      cell(p.name_fr),
      cell(p.name_ar ?? ''),
      dzd(p.buy_price),
      dzd(p.sell_price),
      String(p.tva_rate),
      qty(p.stock_qty),
      cell(p.unit),
      cell(p.category_id),
    ].join(';'));
  }
  return `﻿${lines.join('\n')}\n`;
}

/** Default export filename: baraka-stock-YYYYMMDD-HHmm.csv */
export function stockCsvFilename(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `baraka-stock-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.csv`;
}

export interface AuditCsvRow {
  id: number; ts: string; actor: string; action: string;
  entity: string; entity_id: string; detail: string;
}

/** v1.5.1 §2 (user timeline): audit rows → `;` CSV with BOM (same Excel-safe
 * convention as the stock exporter). Filtered set in, file text out. */
export const AUDIT_CSV_HEADERS = 'id;ts;actor;action;entity;entity_id;detail';

export function buildAuditCsv(rows: AuditCsvRow[]): string {
  const lines = [AUDIT_CSV_HEADERS];
  for (const r of rows) {
    lines.push([
      String(r.id),
      cell(r.ts),
      cell(r.actor),
      cell(r.action),
      cell(r.entity),
      cell(r.entity_id),
      cell(r.detail),
    ].join(';'));
  }
  return `﻿${lines.join('\n')}\n`;
}

/** Default timeline filename: baraka-audit-<actor>-YYYYMMDD-HHmm.csv */
export function auditCsvFilename(actor: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const safe = (actor || 'all').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 24) || 'all';
  return `baraka-audit-${safe}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.csv`;
}

/** Trigger a browser download for in-memory text (USB hand-off = save to the key). */
export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
