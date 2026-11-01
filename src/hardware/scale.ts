/**
 * Baraka Market — RS-232/USB scale lane (T6, ADR-029).
 * No hardware in the shop yet, so this lane is SHIPPED READY, not stubbed:
 * a pure frame parser (CAS / DIGI / Mettler-SICS / bare), a weight-stability
 * voter, and a Web Serial live reader (9600 8N1 — the near-universal scale
 * default) that streams into the existing `scaleWeightGrams` state.
 *
 * Native Rust serial stays DEFERRED (T6b): no `serialport` crate is vendored
 * and the build env is offline. Web Serial covers Edge/WebView2 + Chrome —
 * the exact shells this POS ships on.
 *
 * @module hardware/scale
 */

export interface ScaleReading {
  grams: number;
  stable: boolean;
}

/**
 * Parse one scale text frame. Accepted families:
 *  CAS/DIGI continuous .. "ST,GS,+  1.450kg" / "US,NT,- 12g"
 *  Mettler SICS ......... "S S   1.450 kg" (S=stable) / "S D ..."
 *  Bare ................. "+ 1.450 kg" / "1450g" (unstable by default)
 * Garbage (tare echoes, empty, model banners) => null.
 */
export function parseScaleFrame(line: string): ScaleReading | null {
  const s = line.trim();
  if (!s) return null;
  let m = s.match(/^(ST|US)\s*,\s*(?:GS|NT)\s*,\s*([+-])\s*([\d.]+)\s*(kg|g)\b/i);
  if (m) {
    const v = parseFloat(m[3]);
    if (!Number.isFinite(v)) return null;
    const g = Math.round(v * (m[4].toLowerCase() === 'kg' ? 1000 : 1));
    return { grams: m[2] === '-' ? -g : g, stable: m[1].toUpperCase() === 'ST' };
  }
  m = s.match(/^S\s+([SD])\s+([+-]?)\s*([\d.]+)\s*(kg|g)\b/i);
  if (m) {
    const v = parseFloat(m[3]);
    if (!Number.isFinite(v)) return null;
    const g = Math.round(v * (m[4].toLowerCase() === 'kg' ? 1000 : 1));
    return { grams: m[2] === '-' ? -g : g, stable: m[1].toUpperCase() === 'S' };
  }
  m = s.match(/^([+-])?\s*([\d.]+)\s*(kg|g)\b/i);
  if (m) {
    const v = parseFloat(m[2]);
    if (!Number.isFinite(v)) return null;
    const g = Math.round(v * (m[3].toLowerCase() === 'kg' ? 1000 : 1));
    return { grams: m[1] === '-' ? -g : g, stable: false };
  }
  return null;
}

/**
 * Stability voter: the device flag wins when present; otherwise N
 * consecutive readings within tolerance vote stable. Emits the running
 * estimate on EVERY push (grams always fresh, stable flips when earned).
 */
export class StableWeight {
  private window: number[] = [];

  constructor(
    private readonly need = 3,
    private readonly toleranceGrams = 2,
  ) {}

  push(r: ScaleReading): { grams: number; stable: boolean } {
    if (r.stable) {
      this.window = [r.grams];
      return { grams: r.grams, stable: true };
    }
    this.window.push(r.grams);
    if (this.window.length > this.need) this.window.shift();
    if (this.window.length < this.need) return { grams: r.grams, stable: false };
    const lo = Math.min(...this.window);
    const hi = Math.max(...this.window);
    if (hi - lo <= this.toleranceGrams) {
      const avg = Math.round(this.window.reduce((a, b) => a + b, 0) / this.window.length);
      return { grams: avg, stable: true };
    }
    return { grams: r.grams, stable: false };
  }

  reset(): void {
    this.window = [];
  }
}

export type ScaleLiveStatus = 'unsupported' | 'connecting' | 'live' | 'closed' | 'error';

interface SerialOptions {
  baudRate?: number;
  onStatus?: (s: ScaleLiveStatus) => void;
}

/**
 * Open the cashier-picked serial port and stream stable weights.
 * Resolves 'unsupported' where Web Serial is absent (Node/tests, Firefox).
 * The AbortSignal owns the lifetime — abort closes the port cleanly.
 */
export async function connectLiveScale(
  onWeight: (grams: number, stable: boolean) => void,
  signal: AbortSignal,
  opts: SerialOptions = {},
): Promise<ScaleLiveStatus> {
  const nav = globalThis.navigator as unknown as
    | { serial?: { requestPort: () => Promise<SerialPortLike> } }
    | undefined;
  if (!nav?.serial?.requestPort) return 'unsupported';
  opts.onStatus?.('connecting');
  const voter = new StableWeight();
  let port: SerialPortLike | null = null;
  try {
    port = await nav.serial.requestPort();
    await port.open({ baudRate: opts.baudRate ?? 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  } catch {
    opts.onStatus?.('closed');
    return 'closed'; // cashier cancelled the picker
  }
  opts.onStatus?.('live');
  const done = (async () => {
    try {
      const pipe = port!.readable as unknown as {
        pipeThrough: (t: unknown) => ReadableStream<string>;
      };
      const text = pipe.pipeThrough(new TextDecoderStream());
      const reader = text.getReader();
      let tail = '';
      for (;;) {
        if (signal.aborted) {
          reader.releaseLock();
          break;
        }
        const { value, done: eof } = await reader.read();
        if (eof) break;
        tail += value ?? '';
        const lines = tail.split(/\r?\n/);
        tail = lines.pop() ?? '';
        for (const ln of lines) {
          const r = parseScaleFrame(ln);
          if (!r || r.grams < 0) continue;
          const v = voter.push(r);
          onWeight(v.grams, v.stable);
        }
      }
    } catch {
      if (!signal.aborted) opts.onStatus?.('error');
    } finally {
      try {
        await port?.close();
      } catch { /* port already gone */ }
      if (!signal.aborted) opts.onStatus?.('closed');
    }
  })();
  signal.addEventListener('abort', () => {
    try {
      void port?.close();
    } catch { /* closing */ }
  });
  await done;
  return signal.aborted ? 'closed' : 'error';
}

/** Minimal Web Serial shapes (DOM lib has none) — structural only. */
interface SerialPortLike {
  open: (o: Record<string, unknown>) => Promise<void>;
  readable: ReadableStream<Uint8Array>;
  close: () => Promise<void>;
}
