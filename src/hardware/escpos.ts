/**
 * Baraka Market — Raw ESC/POS byte-buffer compiler (Gate-02 TASK 2).
 * Pure, offline, zero-dependency. Converts a sale/quittance into a
 * deterministic Uint8Array for direct thermal-printer dispatch (USB/COM/raw
 * spooler via Lane A) while the CSS spooler (Lane B, window.print) stays
 * as the instant fallback.
 *
 * Command set used:
 *  ESC @          1B 40             init
 *  ESC a n        1B 61 n           align 0=left 1=center 2=right
 *  ESC E n        1B 45 n           bold on/off
 *  ESC d n        1B 64 n           print & feed n lines
 *  GS V B 0       1D 56 42 00      partial cut
 *  ESC p m t1 t2  1B 70 00 19 FA   drawer kick, pin 2, 25ms x 250
 *
 * Text is encoded as UTF-8 after French-diacritic folding so output is
 * byte-deterministic on every machine. Arabic names are passed through as
 * UTF-8 (modern 80mm firmware with UTF-8/arabic codepage renders them;
 * legacy firmware shows the transliterated fallback note).
 *
 * @module hardware/escpos
 */

export const ESC_INIT = [0x1b, 0x40] as const;
export const ESC_ALIGN_LEFT = [0x1b, 0x61, 0x00] as const;
export const ESC_ALIGN_CENTER = [0x1b, 0x61, 0x01] as const;
export const ESC_ALIGN_RIGHT = [0x1b, 0x61, 0x02] as const;
export const ESC_BOLD_ON = [0x1b, 0x45, 0x01] as const;
export const ESC_BOLD_OFF = [0x1b, 0x45, 0x00] as const;
/** Standard 24V cash-drawer pulse on pin 2: ESC p 0 25 250 */
export const ESCPOS_DRAWER_KICK = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);
/** Partial paper cut: GS V 66 0 */
export const ESCPOS_PAPER_CUT = new Uint8Array([0x1d, 0x56, 0x42, 0x00]);

const LF = 0x0a;

/** Fold French diacritics to 7-bit so ESC/POS output is deterministic. */
export function foldLatin(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[«»]/g, '"')
    .replace(/’/g, "'");
}

function enc(s: string): number[] {
  return Array.from(new TextEncoder().encode(foldLatin(s)));
}

function line(s = ''): number[] {
  return [...enc(s), LF];
}

export interface EscPosItem {
  name: string;
  qty: number;
  unit: string;
  lineTtc: number;
}

export interface EscPosSale {
  storeName: string;
  rc?: string;
  nif?: string;
  invoice: string;
  ticket: string;
  date: string;
  cashier: string;
  items: EscPosItem[];
  totalHt: number;
  tva9Base: number;
  tva9Amt: number;
  tva19Base: number;
  tva19Amt: number;
  timbre: number;
  totalTtc: number;
  paymentMethod: string;
  amountPaid: number;
  changeDue: number;
}

const money = (n: number) => `${n.toFixed(2)} DZD`;
const sep32 = '-'.repeat(32);

function feed(n: number): number[] {
  return [0x1b, 0x64, Math.max(0, Math.min(255, n))];
}

/** Compile a full fiscal ticket buffer (header, rows, tax table, kick, cut). */
export function buildReceipt(s: EscPosSale, opts: { kickDrawer?: boolean } = {}): Uint8Array {
  const out: number[] = [];
  out.push(...ESC_INIT);
  out.push(...ESC_ALIGN_CENTER, ...ESC_BOLD_ON);
  out.push(...line(s.storeName));
  out.push(...ESC_BOLD_OFF);
  if (s.rc) out.push(...line(`RC:${s.rc}`));
  if (s.nif) out.push(...line(`NIF:${s.nif}`));
  out.push(...line(sep32));
  out.push(...ESC_ALIGN_LEFT);
  out.push(...line(`${s.invoice}  ${s.ticket}`));
  out.push(...line(`${s.date} ${s.cashier}`));
  out.push(...line(sep32));
  for (const it of s.items) {
    out.push(...line(`${it.qty}${it.unit === 'KG' ? 'kg' : 'x'} ${it.name}`.slice(0, 32)));
    const right = money(it.lineTtc);
    out.push(...line(`  ${right}`.padStart(32)));
  }
  out.push(...line(sep32));
  out.push(...line(`HT ${money(s.totalHt)}`));
  out.push(...line(`TVA 9% base ${money(s.tva9Base)} +${money(s.tva9Amt)}`));
  out.push(...line(`TVA 19% base ${money(s.tva19Base)} +${money(s.tva19Amt)}`));
  out.push(...line(`Timbre Art.136 +${money(s.timbre)}`));
  out.push(...ESC_BOLD_ON);
  out.push(...line(`TOTAL TTC ${money(s.totalTtc)}`.padStart(32)));
  out.push(...ESC_BOLD_OFF);
  out.push(...line(`${s.paymentMethod} paye:${money(s.amountPaid)} rendu:${money(s.changeDue)}`));
  out.push(...line('Merci de votre visite - Baraka'));
  out.push(...feed(3));
  if (opts.kickDrawer !== false) out.push(...ESCPOS_DRAWER_KICK);
  out.push(...ESCPOS_PAPER_CUT);
  return new Uint8Array(out);
}

export interface EscPosQuittance {
  storeName: string;
  receipt: string;
  date: string;
  clientName: string;
  prevBalance: number;
  amount: number;
  timbre: number;
  collected: number;
  newBalance: number;
  paymentMethod: string;
}

/** Compile a debt-settlement quittance buffer (Art.136 receipt). */
export function buildQuittance(q: EscPosQuittance): Uint8Array {
  const out: number[] = [];
  out.push(...ESC_INIT, ...ESC_ALIGN_CENTER, ...ESC_BOLD_ON);
  out.push(...line(q.storeName));
  out.push(...line('QUITTANCE DE REGLEMENT'));
  out.push(...ESC_BOLD_OFF);
  out.push(...line(q.receipt));
  out.push(...line(sep32));
  out.push(...ESC_ALIGN_LEFT);
  out.push(...line(`Client: ${q.clientName}`.slice(0, 32)));
  out.push(...line(`Dette avant: ${money(q.prevBalance)}`));
  out.push(...line(`Encaisse: ${money(q.amount)}`));
  out.push(...line(`Timbre Art.136: +${money(q.timbre)}`));
  out.push(...ESC_BOLD_ON);
  out.push(...line(`Collecte: ${money(q.collected)}`.padStart(32)));
  out.push(...ESC_BOLD_OFF);
  out.push(...line(`Solde restant: ${money(q.newBalance)}`));
  out.push(...line(`${q.date} ${q.paymentMethod}`));
  out.push(...line('Recu tenant lieu de quittance'));
  out.push(...feed(3));
  out.push(...ESCPOS_DRAWER_KICK);
  out.push(...ESCPOS_PAPER_CUT);
  return new Uint8Array(out);
}

/** Lane A export: download a raw .bin buffer (USB/COM spooler handoff). */
export function downloadRaw(buffer: Uint8Array, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([buffer as unknown as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Subsequence search used by tests and spool verification. */
export function containsBytes(haystack: Uint8Array, needle: readonly number[] | Uint8Array): boolean {
  const n = Array.from(needle);
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (haystack[i + j] !== n[j]) continue outer;
    }
    return true;
  }
  return false;
}
