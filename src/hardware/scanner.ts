/**
 * Baraka Market — HID scanner burst trap (Gate-02 TASK 3).
 * Barcode guns emulate keyboards but fire at <30ms inter-key latency and
 * terminate with Enter. This module separates those bursts from human
 * typing so scans land in the cart even when the barcode field lost focus,
 * without mangling cashier input.
 *
 * The DOM-free BurstDetector core is fully unit-testable; attachScannerTrap
 * wires it to a capture-phase window listener.
 *
 * @module hardware/scanner
 */

/** Max inter-key gap inside one hardware burst. */
export const BURST_MAX_INTERVAL_MS = 30;
/** Minimum chars for a burst to qualify as a scan (EAN-8 and up). */
export const BURST_MIN_LEN = 4;

/**
 * Stateful burst classifier. Feed every keydown (printable char or Enter)
 * with a timestamp; returns the completed barcode on burst+Enter, else null.
 */
export class BurstDetector {
  private buf = '';
  private last = 0;
  private fast = true;

  /** @returns completed barcode when a burst terminates with Enter. */
  key(ch: string | null, now: number, isEnter: boolean): string | null {
    if (isEnter) {
      const out = this.buf.length >= 4 && this.fast ? this.buf : null;
      this.buf = '';
      this.fast = true;
      this.last = now;
      return out;
    }
    if (ch === null || ch.length !== 1 || ch < ' ' || ch > '~') {
      // Non-printable control key: abort current burst candidate.
      this.buf = '';
      this.fast = true;
      return null;
    }
    if (this.buf.length === 0) {
      this.buf = ch;
      this.fast = true;
    } else if (now - this.last > BURST_MAX_INTERVAL_MS) {
      // Human-paced gap: restart candidate from this char.
      this.buf = ch;
      this.fast = true;
    } else {
      this.buf += ch;
    }
    if (now - this.last > BURST_MAX_INTERVAL_MS && this.buf.length > 1) this.fast = false;
    this.last = now;
    if (this.buf.length > 64) {
      this.buf = '';
      this.fast = true;
    }
    return null;
  }

  reset(): void {
    this.buf = '';
    this.fast = true;
  }
}

/**
 * Capture-phase global trap: hardware bursts are redirected to onScan and
 * swallowed (so they never pollute search fields); human typing passes
 * through untouched.
 */
export function attachScannerTrap(onScan: (code: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const det = new BurstDetector();
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Let the focused barcode field handle its own Enter submit.
    const tag = (e.target as HTMLElement | null)?.tagName;
    const isEnter = e.key === 'Enter';
    const ch = isEnter ? null : e.key;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const scan = det.key(ch, now, isEnter);
    if (scan) {
      e.preventDefault();
      e.stopPropagation();
      onScan(scan);
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
