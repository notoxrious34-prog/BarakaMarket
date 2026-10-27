/**
 * Baraka Market — manager override PIN gate (ADR-014-MKT).
 * Pure, zero-dependency: SHA-256(salt + ':' + PIN), constant-time compare.
 *
 * @module core/security
 */
import { sha256Hex } from './sha256.js';

/** Default PIN when no custom hash is stored (first-boot / reset). */
export const DEFAULT_MANAGER_PIN = '1234';
/** Meta key holding `saltHex:hashHex`. */
export const MANAGER_PIN_META_KEY = 'manager_pin_hash';

/** 4–8 numeric digits. */
export function isValidPinFormat(pin: string): boolean {
  if (pin.length < 4 || pin.length > 8) return false;
  for (const ch of pin) if (ch < '0' || ch > '9') return false;
  return true;
}

const randomSaltHex = (bytes = 16): string => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
};

/** Create a storable `saltHex:hashHex` verifier for a new PIN. Throws on bad format. */
export function createPinHash(pin: string): string {
  if (!isValidPinFormat(pin)) throw new Error('[security] PIN must be 4-8 numeric digits');
  const salt = randomSaltHex();
  return `${salt}:${sha256Hex(`${salt}:${pin}`)}`;
}

/** Constant-time string equality (timing-attack resistant). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify an input PIN against a stored `salt:hash` verifier.
 * When no verifier is stored, the default PIN applies.
 */
export function verifyPin(inputPin: string, storedHash?: string | null): boolean {
  if (!storedHash) return safeEqual(inputPin, DEFAULT_MANAGER_PIN);
  const sep = storedHash.indexOf(':');
  if (sep < 0) return false;
  const salt = storedHash.slice(0, sep);
  const expected = storedHash.slice(sep + 1);
  return safeEqual(sha256Hex(`${salt}:${inputPin}`), expected);
}
