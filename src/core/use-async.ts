import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * use-async.ts — MKT-010 shared hook (P1 adoption starts in CashSessionsView).
 *
 * Mount-once resource loader with stale-race guard: only the latest `load`
 * may write state. Returns the last good data (never wiped on reload) plus
 * an explicit `reload` for buttons and pollers.
 */
export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
}

export function useAsyncResource<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const v = await loader();
      if (seq.current === id) { setData(v); setError(null); }
    } catch (e) {
      if (seq.current === id) setError(e);
    } finally {
      if (seq.current === id) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load };
}
