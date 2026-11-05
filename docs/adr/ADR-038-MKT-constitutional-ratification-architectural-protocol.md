# ADR-038-MKT: constitutional ratification of the architectural protocol directive

- **Status:** ACCEPTED
- **Date:** 2026-11-05
- **Amends:** `CONSTITUTION_OF_EXECUTOR.md` v2-MKT → v3-MKT (new §6)
- **Ratifies:** `docs/architecture/ARCHITECTURAL-PROTOCOL-DIRECTIVE-v1.0-MKT.md`
- **Precedent:** ADR-019 (charter amendment + doc hygiene)

## Context

The owner issued the Supreme Directive — Architectural Protocol for Baraka Market
(Mission-Critical Enterprise System, Microsoft/Tier-1 bar): promotion to Principal
Enterprise System Architect, five binding pillars (ACID & Idempotency, Design for
Failure, Zero-Trust Security, Clean Architecture/DDD, Observability), a
think-before-execute protocol, four red lines, and a duty of engineering
objection. The directive orders its own preservation in the constitution to
guarantee context and high-level session starts.

## Decision

1. The Arabic directive is preserved verbatim as
   `docs/architecture/ARCHITECTURAL-PROTOCOL-DIRECTIVE-v1.0-MKT.md` (binding source).
2. The Constitution is amended to **v3-MKT** with a new §6
   (Enterprise Architecture Protocol): operational English counterpart of the
   five articles, grounded in existing project mechanisms (idempotency keys,
   `lastLaneError` lanes, owner re-gating, audit trail, pure fiscal engines),
   plus a **Session Boot rule (§6.5)**: every dev session opens by re-reading
   the Constitution, the Directive, and the task-relevant ADRs before touching code.
3. The Executor identity is updated accordingly (first responsible under the
   human owner/principal). Stale gate floor corrected in passing: 58/58 → 392/392
   (verified current count; law must not lie).

## Consequences

- Every future session inherits mission-critical context at boot — no cold starts.
- The objection duty is now constitutional: insecure requests are refused with
  an alternative, not obeyed.
- No code impact: documentation-only change. Gates unaffected (md files unlinted).
