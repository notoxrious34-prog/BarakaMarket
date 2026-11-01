/**
 * Baraka Market — Customer pole display compiler (T5, ADR-028).
 * Pure, offline, zero-dependency. Targets the common 2x20 VFD class
 * (EPSON DM-D and compatibles) with a portable command subset:
 *
 *  CLR 0x0C ......... clear + home
 *  CR  0x0D ......... advance to line 2 (auto-wrap class)
 *  ESC * n 1B 2A n .. brightness 0..4 (DM-D standard)
 *
 * Hardware-specific cursor addressing is INTENTIONALLY avoided: after CLR
 * the display auto-advances, so CLR + 20 + CR + 20 renders identically on
 * the whole class. Lines are folded to Latin, padded/truncated to exactly
 * 20 columns — byte-deterministic on every machine.
 *
 * @module hardware/pole-display
 */

export const POLE_COLS = 20;
export const POLE_ROWS = 2;
export const POLE_CLEAR = 0x0c;
export const POLE_CR = 0x0d;

function encoder(): (s: string) => number[] {
  const te = new TextEncoder();
  return (s: string) =>
    Array.from(
      te.encode(
        s
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[«»]/g, '"')
          .replace(/’/g, "'"),
      ),
    );
}

const enc = encoder();

/** Exactly 20 columns: fold, pad, truncate. */
export function poleLine(s: string): number[] {
  const bytes = enc(s).slice(0, POLE_COLS);
  while (bytes.length < POLE_COLS) bytes.push(0x20);
  return bytes;
}

/** Brightness 0..4 (clamped). */
export function poleBrightness(n: number): number[] {
  return [0x1b, 0x2a, Math.max(0, Math.min(4, Math.round(n)))];
}

function frame(top: string, bottom: string, bright = 4): Uint8Array {
  return new Uint8Array([
    ...poleBrightness(bright),
    POLE_CLEAR,
    ...poleLine(top),
    POLE_CR,
    ...poleLine(bottom),
  ]);
}

/** Idle welcome screen (store name + fiscal-mode tag). */
export function buildPoleWelcome(storeName: string): Uint8Array {
  return frame(storeName, 'MODE FISCAL ACTIF');
}

/** Amount due while the cashier totals the cart. */
export function buildPoleTotal(totalTtc: number): Uint8Array {
  return frame('TOTAL A PAYER', `${totalTtc.toFixed(2)} DZD`);
}

/** Cash tendered + change (or card/debt acknowledgement). */
export function buildPoleTendered(paid: number, change: number, method: string): Uint8Array {
  const bottom = method === 'ESPECES' ? `RENDU ${change.toFixed(2)}` : `${method} MERCI`;
  return frame(`PAYE ${paid.toFixed(2)}`, bottom);
}

/** Thank-you close after the ticket prints. */
export function buildPoleThanks(): Uint8Array {
  return frame('MERCI DE VOTRE', 'VISITE - BARAKA');
}
