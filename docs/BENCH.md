# BENCH — engine budgets (measured 2026-10-26, `npm run bench`)

| Path | Avg | Budget | Verdict |
|---|---|---|---|
| 1 sale line (TTC→HT/TVA) | 0.0003 ms | 150 ms | PASS (~500 000× headroom) |
| 4-line golden sale + timbre | 0.0006 ms | 150 ms | PASS |
| SQLite seq next (UPDATE..RETURNING) | 0.0685 ms | 150 ms | PASS (~2 000× headroom) |

Conclusion: the fiscal core can never be the POS bottleneck; remaining latency
budget belongs to rendering + (later) hardware I/O. Re-run after every engine change.
