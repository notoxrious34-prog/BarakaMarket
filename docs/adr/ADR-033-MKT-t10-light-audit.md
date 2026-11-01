# ADR-033-MKT — T10: light transactional audit

- Status: ACCEPTED 2026-11-01 (T10 DONE — 262/262 + Rust 11/11).
- Updates: extends ADR-031 (T8 security audit) to fiscal events.
- Related: PROGRAM-BLUEPRINT-v2.0 T10.

## Context

T8 gave us the security trail (`audit_log`: logins, users, PINs). Money itself
left no actor-stamped trace: a sale committed, a debt collected, a void, a Z
closed — and the trail couldn't say WHO. The fiscal facts live in dedicated
tables (sales, settlements, void_log, Z) but the WHO was missing or scattered.

## Decision

**Light = actor + event + reference, nothing more.** Four actions join the
`AuditAction` union (`rbac.ts`): `sale.commit`, `settlement.commit`,
`sale.void`, `z.close`. No schema change — `audit_log` already fits.

Wiring (two choke points, both fire-and-forget):

1. **Client-side (AppContext, both lanes uniform).** `auditFiscal()` stamps the
   live `session.username` on every authoritative money event: direct sale
   commit (`FACT… · total`), replayed upgrades (`… (replay)`), direct and
   replayed settlements. Provisional-only rows are NOT audited — nothing
   fiscal happened yet. Works in the exe via `invoke('audit_log')`; in a
   token-less browser it drops silently (dev lane, by design).
2. **Server-side (void + Z, no client flow exists).** `POST /sales/:id/void`
   logs `sale.void` with the `by` actor + reason; `POST /cash/close-and-z`
   accepts `actor` and logs `z.close` with Z number + cash diff. This covers
   lanes no UI event reaches.
3. **CashSessionsView** now reads `session` (cashier defaults to the operator,
   Z-close posts `actor: username`).

## Consequences

- Every dinar movement is attributable: sale → FACT + actor, settlement →
  Q + actor, void → reason + actor, Z → diff + actor.
- Zero new tables, zero migrations, zero latency risk (all audit writes are
  best-effort, never on the commit path).
- Tests: server proves both server-side rows (`sale.void`, `z.close` with
  actor match); client-side calls ride the existing `auditSessionEvent`
  contract (never throws, T8-tested).
