import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Fetched, Provenance } from '../lib/http';

export interface AsyncState<T> {
  data: T | null;
  provenance: Provenance | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/**
 * Run one data fetch, keyed by `deps`.
 *
 * A stale response never wins: each run gets its own AbortController and a
 * generation counter, so a slow request that resolves after the user changed
 * the fiscal year is discarded rather than painted over the new one.
 */
export function useAsyncData<T>(
  loader: (signal: AbortSignal) => Promise<Fetched<T>>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [provenance, setProvenance] = useState<Provenance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const generation = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's key
  const key = useMemo(() => deps, deps);

  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    const run = generation.current;

    setLoading(true);
    setError(null);

    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (run !== generation.current) return;
        setData(result.data);
        setProvenance(result.provenance);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (run !== generation.current || controller.signal.aborted) return;
        setData(null);
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      })
      .finally(() => {
        if (run !== generation.current) return;
        setLoading(false);
      });

    return () => controller.abort();
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, provenance, loading, error, reload };
}
