# ADR-036-MKT — T12 gold-master close-out (v1.1.0 shipped)

- Status: ACCEPTED 2026-11-01 (T12 DONE — release live, P0 proven on iron).
- Updates: closes ADR-032 (updater live) + ADR-035 (login proven).
- Related: PROGRAM-BLUEPRINT-v2.0 T12, §11 shop-ready definition.

## What shipped

`v1.1.0` — rebuilt from `7a07ac5` (WITH the `change_pin` fix; the earlier
1.1.0 bundle predated it and was discarded, never published):
`BarakaMarket-1.1.0-setup.exe` (5.11 MiB) + `.sig` + `latest.json`, signed
with `.secrets` key, `SIG-OK [ED]` verified twice (local bytes + the exact
bytes re-downloaded from the public feed). Release page live, tag `v1.1.0`.

## Live proofs (this machine, installed copy)

1. **Fresh provision:** exe on empty profile → `baraka.db` ready, 25 tables,
   7 triggers, `user_version = 5`, WAL, owner seeded `must_change_pin = 1`.
2. **P0 closed on iron:** `owner/1234` → forced-change → `5678` → confirm →
   POS as `Gérant (owner)`. Shop DB now reads `must_change_pin = 0` with a
   `pin.change` audit row; the new PIN re-verified with a second `login.ok`.
   (Owner note: the till PIN is now `5678` — rotate it in Users when ready.)
3. **Updater chain:** public feed serves `latest.json` (`version 1.1.0`,
   `windows-x86_64`, correct asset URL + signature); the downloaded setup
   verifies against the pinned pubkey. The in-app Check button (Settings →
   التحديثات) reads this feed.

## Residue (honest list)

- The 8h real-cashier soak stays a shop-floor step (mechanical soak green).
- T3 visual typos/truncation remain the known cosmetic backlog.
- In-app download+install click-through was NOT pressed on the shop machine
  (deliberately — it would restart the till mid-E2E); the chain up to the
  click is proven, the click itself is a first-shop-day step.
- No process was left running; smoke/scratch DBs deleted; shop DB keeps
  exactly owner + PIN change (the desired state).
