/**
 * A3 (PLAN-v1.2.0): single live version source. The footer, ticket stamp and
 * updater card all read this — never a hardcoded literal (guarded by
 * version-guard.test.ts).
 */
import pkg from '../../package.json';

export const APP_VERSION: string = (pkg as { version?: unknown }).version as string;

if (!/^\d+\.\d+\.\d+$/.test(APP_VERSION)) {
  throw new Error(`[version] package.json version is not semver: ${String(APP_VERSION)}`);
}
