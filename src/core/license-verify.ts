/**
 * Baraka Market — stored-license assessment (L1-fix, v1.4.5).
 * Trust-on-read is over: an ACTIVATED flag in localStorage proves nothing
 * until the key re-verifies. Two tiers:
 *   crypto — the key's Ed25519 signature over (store || ACTIVATION hwid);
 *   drift  — the activation HWID vs this machine. Owner decision (v1.4.5):
 *            drift on a KNOWN activation HWID locks the till until
 *            re-activation; legacy records with NO hwid stay grandfathered
 *            (warning only, never a lock).
 * The verifier is injected so every rule is unit-tested without crypto.
 *
 * @module core/license-verify
 */
import type { StoredLicense } from './license-store';

export interface LicenseAssessment {
  /** Signature genuinely covers (store || activation hwid). */
  cryptoOk: boolean;
  /** Activation HWID differs from this machine (or is absent legacy). */
  drift: boolean;
}

export async function assessStoredLicense(
  rec: StoredLicense,
  currentHwid: string,
  verify: (storeName: string, hwid: string, key: string) => Promise<boolean>,
): Promise<LicenseAssessment> {
  const activationHwid = rec.hwid?.trim() ? rec.hwid.trim() : currentHwid;
  const cryptoOk = await verify(rec.storeName, activationHwid, rec.key);
  const drift = !rec.hwid?.trim() ? true : rec.hwid.trim() !== currentHwid;
  return { cryptoOk, drift };
}
