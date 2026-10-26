/**
 * Baraka Market — Synthesized tactile audio (Gate-02 TASK 4).
 * ZERO binary assets: every cue is a Web Audio API oscillator graph.
 * All entry points are headless-safe (no AudioContext => return false,
 * never throw) so unit tests and SSR-style imports stay green.
 *
 * Spec:
 *  scan  : 880Hz -> 1760Hz linear ramp, 45ms, gain 0.15
 *  error : 180Hz + 185Hz sawtooth dissonance, 150ms
 *  cash  : 1046.5Hz (C6) 60ms then 1318.5Hz (E6) 80ms
 *
 * @module hardware/sound
 */

export const SCAN_START_HZ = 880;
export const SCAN_END_HZ = 1760;
export const SCAN_MS = 45;
export const SCAN_GAIN = 0.15;

export const ERR_HZ_A = 180;
export const ERR_HZ_B = 185;
export const ERR_MS = 150;

export const CASH_HZ_1 = 1046.5;
export const CASH_MS_1 = 60;
export const CASH_HZ_2 = 1318.5;
export const CASH_MS_2 = 80;

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** True when a real output device path exists (browser with WebAudio). */
export function hardwareAvailable(): boolean {
  return ac() !== null;
}

function tone(
  freqStart: number,
  freqEnd: number,
  ms: number,
  type: OscillatorType,
  gain: number,
  whenMs = 0,
): boolean {
  const c = ac();
  if (!c) return false;
  try {
    const t0 = c.currentTime + whenMs / 1000;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    if (freqEnd !== freqStart) osc.frequency.linearRampToValueAtTime(freqEnd, t0 + ms / 1000);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
    return true;
  } catch {
    return false;
  }
}

/** HID scan success chime: 880Hz -> 1760Hz, 45ms. */
export function scanBeep(): boolean {
  return tone(SCAN_START_HZ, SCAN_END_HZ, SCAN_MS, 'sine', SCAN_GAIN);
}

/** Blocked-item buzzer: 180Hz + 185Hz sawtooth dissonance, 150ms. */
export function errorBuzz(): boolean {
  const a = tone(ERR_HZ_A, ERR_HZ_A, ERR_MS, 'sawtooth', SCAN_GAIN);
  const b = tone(ERR_HZ_B, ERR_HZ_B, ERR_MS, 'sawtooth', SCAN_GAIN);
  return a || b;
}

/** Cash sale / drawer chime: C6 60ms then E6 80ms. */
export function cashChime(): boolean {
  const a = tone(CASH_HZ_1, CASH_HZ_1, CASH_MS_1, 'sine', SCAN_GAIN, 0);
  const b = tone(CASH_HZ_2, CASH_HZ_2, CASH_MS_2, 'sine', SCAN_GAIN, CASH_MS_1);
  return a || b;
}
