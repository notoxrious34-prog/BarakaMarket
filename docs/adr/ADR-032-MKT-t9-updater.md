# ADR-032-MKT — T9: updater (GitHub Releases auto + USB manual)

- Status: ACCEPTED 2026-11-01 (T9 DONE — 260/260 + Rust 11/11; live E2E deferred to T12 rehearsal).
- Updates: none (new record).
- Related: PROGRAM-BLUEPRINT-v2.0 T9, repo `notoxrious34-prog/BarakaMarket` (public).

## Context

One till today; tomorrow there may be two. Updates must work WITH internet
(auto) and WITHOUT (USB hand-carry). The shop may never phone anywhere except
the update check — Zero-Cloud holds.

## Decision

1. **Tauri updater, silent.** `tauri-plugin-updater` (`dialog: false`) +
   `createUpdaterArtifacts: true` on the NSIS target. Feed:
   `.../releases/latest/download/latest.json`. No dialog ever — the UI drives
   check/download/install explicitly (AR/FR) so a cashier never gets a
   surprise restart mid-shift.
2. **Check free, install gated.** Every role may CHECK (information);
   download+install is manager+ (`role !== 'cashier'`). Both audited
   (`update.check` / `update.install` — union extended in `rbac.ts`).
3. **Signing keypair generated locally** (`D:/baraka-secrets/baraka-updater.key`,
   OUTSIDE the repo, no password for non-interactive release signing).
   Public key pinned in `tauri.conf.json`. The private key file MUST be backed
   up to USB by the owner — losing it orphans every installed copy (it will
   reject all future updates). Release signing: `TAURI_SIGNING_PRIVATE_KEY`
   env at `tauri build` time.
4. **CSP opened minimally** for the feed + asset host only:
   `https://github.com https://objects.githubusercontent.com`.
5. **USB remains first-class.** The Settings card links the Releases page;
   any release asset installs by hand. The lane only automates the same
   signed bundle (`latest.json` + `.sig` are published beside the `.exe`).
6. **Restart via `tauri-plugin-process` relaunch** (capability
   `process:default`; `updater:default` verified against the vendored crate
   `permissions/default.toml` — never guessed).

## Consequences

- Shop machines need zero accounts, zero tokens: the repo is PUBLIC, the
  feed + bundle are anonymous reads. Push/release stay owner-side (gh).
- Version triple bump per release: `package.json` + `tauri.conf.json` +
  `UpdateManagerView.current` (documented; T10 may centralize).
- Live proof (draft pre-release → install on the spare profile) is T12
  exit-criteria, not T9: it needs a published signed bundle.
