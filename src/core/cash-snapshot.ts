/**
 * cash-snapshot.ts — MKT-010 (Clôture shell thinning).
 *
 * Pure extraction of CashSessionsView.refresh: given an injected lane
 * (sessions / movements / active), produce one CashSnapshot. The view owns
 * rendering; this module owns the cold-start retry and the open/none/down
 * branches — all covered by cash-snapshot.test.ts.
 */

/** Minimal live session status consumed by the close islands. */
export interface CashLiveStatus {
  session: { id: string; cashierName: string; openedAt: string };
  openingFloatCt: number; cashSalesCt: number; settlementsCashCt: number;
  depositsCt: number; withdrawalsCt: number; expensesCt: number;
  theoreticalCashCt: number; totalSalesCount: number;
}

/** One row of the session history / movement trail. */
export interface CashSessionRow {
  id: string; cashierName: string; openedAt: string; closedAt?: string;
  openingFloatCt: number; closingCountedCt?: number; theoreticalCashCt?: number;
  cashDiffCt?: number; status: 'OPEN' | 'CLOSED'; zReportId?: string; notes?: string;
}

/** One till movement. */
export interface CashMovementRow {
  id: string; type: 'DEPOSIT' | 'WITHDRAWAL' | 'EXPENSE';
  amountCt: number; reason: string; createdAt: string;
}

/** One atomic view of the till. */
export interface CashSnapshot {
  history: CashSessionRow[];
  openId: string | null;
  movements: CashMovementRow[];
  active: CashLiveStatus | null;
  /** False only when BOTH probes miss — never declared on a fossil. */
  laneAlive: boolean;
}

/** Injected lane (the authority in production, fakes in tests). */
export interface CashLane {
  sessions: (limit: number) => Promise<unknown>;
  movements: (sessionId: string, limit: number) => Promise<unknown>;
  active: () => Promise<unknown>;
}

/** Result of a SHIFT close (carries the Z number + gap verdict). */
export interface CashCloseResult {
  zNumber: string; theoreticalCashCt: number; closingCountedCt: number;
  cashDiffCt: number; hash: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

/**
 * Load one cash snapshot. Cold-start flash: the very first probe after
 * WebView boot can lose the race — one deferred retry before honestly
 * declaring the lane down. `retryMs` is injectable for fast tests.
 */
export async function loadCashSnapshot(lane: CashLane, retryMs = 1500): Promise<CashSnapshot> {
  const empty: CashSnapshot = { history: [], openId: null, movements: [], active: null, laneAlive: false };
  let probe = await lane.sessions(10);
  // One deferred retry before honestly declaring the lane down.
  if (!Array.isArray(probe)) {
    await sleep(retryMs);
    probe = await lane.sessions(10);
  }
  if (!Array.isArray(probe)) return empty;
  const history = probe as CashSessionRow[];
  const open = history.find(r => r.status === 'OPEN') ?? null;
  const target = open ?? history[0] ?? null;
  let movements: CashMovementRow[] = [];
  if (target) {
    const m = await lane.movements(target.id, 50);
    if (Array.isArray(m)) movements = m as CashMovementRow[];
  }
  let active: CashLiveStatus | null = null;
  if (open) {
    const a = await lane.active();
    // No session open is a legitimate till state, not an outage — but here
    // `open` exists, so a null active simply yields live:null (open form
    // shows the session row, the till card falls back below).
    if (a && typeof a === 'object') active = a as CashLiveStatus;
  }
  return { history, openId: open?.id ?? null, movements, active, laneAlive: true };
}
