# ADR-029-MKT — T6: RS-232 Scale Lane (Shipped Ready, No Hardware Yet)

**Status:** Accepted · **Date:** 2026-11-01 · **Release:** target v1.1.1
**Implements:** PROGRAM-BLUEPRINT-v2.0 T6.

## Decision
1. New `src/hardware/scale.ts` — pure, tested, dependency-free:
   - `parseScaleFrame`: CAS/DIGI (`ST/US,GS/NT,±v kg|g`), Mettler SICS
     (`S S/D v kg|g`), bare (`±v kg|g`). Tare echoes, banners, garbage →
     null. Grams are integers (Math.round at parse).
   - `StableWeight` voter: device-stable flag wins immediately; otherwise
     N=3 consecutive readings within ±2g vote stable. Every push emits the
     running estimate `{grams, stable}` — flapping never stabilizes.
   - `connectLiveScale` (Web Serial, 9600 8N1 default): cashier picks the
     port, read loop splits lines, negative grams skipped, AbortSignal owns
     the lifetime. Absent serial → `'unsupported'`, never throws.
2. Native Rust serial DEFERRED (T6b, documented): no `serialport` crate is
   vendored and the build env is offline. Web Serial covers Edge/WebView2 —
   the exact shells this POS ships on. The parser/voter are backend-neutral
   and reused as-is when T6b lands.
3. `ScaleSimulationModal`: "Connect live scale" button streams live grams
   into the SAME weight state (barcode + POS flow identical). Disconnect =
   abort. Simulation chips/sliders untouched.

## Evidence
- `src/hardware/scale.test.ts` **7/7**: all three frame families, garbage
   rejection, immediate device-stable, 3-vote stability, flapping guard,
   serial-absent contract. Full suite **241/241**, `tsc` clean.

## Consequences
Day-one hardware arrival = plug the scale, pick the port, weigh. Zero
code changes, zero new failure modes (abort-safe, parse-total).
T7 next: power-cut drill (WAL crash-recovery + outbox replay proof).
