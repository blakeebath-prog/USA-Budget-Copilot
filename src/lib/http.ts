import { cacheKey } from '../../shared/cacheKey.mjs';
import type { Upstream } from './sources';

export type DataMode = 'proxy' | 'direct' | 'snapshot';

const DEFAULT_HOSTS: Record<Upstream, string> = {
  usaspending: 'https://api.usaspending.gov',
  fiscaldata: 'https://api.fiscaldata.treasury.gov',
};

const PROXY_PREFIX: Record<Upstream, string> = {
  usaspending: '/proxy/usaspending',
  fiscaldata: '/proxy/fiscaldata',
};

export function getDataMode(): DataMode {
  const configured = import.meta.env.VITE_DATA_MODE;
  if (configured === 'proxy' || configured === 'direct' || configured === 'snapshot') return configured;
  return import.meta.env.DEV ? 'proxy' : 'direct';
}

function upstreamHost(upstream: Upstream): string {
  const override =
    upstream === 'usaspending' ? import.meta.env.VITE_USASPENDING_BASE : import.meta.env.VITE_FISCALDATA_BASE;
  return (override ?? DEFAULT_HOSTS[upstream]).replace(/\/$/, '');
}

/** The URL actually fetched, given the current data mode. */
export function resolveUrl(upstream: Upstream, path: string, mode: DataMode = getDataMode()): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (mode === 'proxy') return `${PROXY_PREFIX[upstream]}${normalized}`;
  return `${upstreamHost(upstream)}${normalized}`;
}

/** The canonical public URL, shown to the reader regardless of how we fetched it. */
export function citationUrl(upstream: Upstream, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${DEFAULT_HOSTS[upstream]}${normalized}`;
}

export interface Provenance {
  sourceId: string;
  /** Canonical upstream URL, suitable for showing to a reader. */
  url: string;
  method: 'GET' | 'POST';
  requestBody?: unknown;
  retrievedAt: string;
  origin: 'network' | 'memory-cache' | 'snapshot';
}

export interface Fetched<T> {
  data: T;
  provenance: Provenance;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  upstream: Upstream;
  sourceId: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  /** How long a successful response stays usable in memory. Default 30 minutes. */
  ttlMs?: number;
}

interface CacheEntry {
  expiresAt: number;
  value: Fetched<unknown>;
}

const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Fetched<unknown>>>();

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [500, 1500, 4000];

export function clearCache(): void {
  memoryCache.clear();
  inFlight.clear();
}

/** Requests that fail with these statuses are worth retrying; the rest are not. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function fetchOnce(url: string, options: RequestOptions, signal: AbortSignal): Promise<unknown> {
  const method = options.method ?? 'GET';
  const response = await fetch(url, {
    method,
    signal,
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApiError(
      `${method} ${url} failed with HTTP ${response.status}`,
      url,
      response.status,
      text.slice(0, 500),
    );
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(
      `${method} ${url} returned a body that is not JSON. The upstream API may be behind a login or error page.`,
      url,
      response.status,
      text.slice(0, 500),
    );
  }
}

/**
 * One request against a government API, with an in-memory cache, request
 * de-duplication, a timeout, bounded retries, and provenance attached to the
 * result so any figure can be traced back to the exact call that produced it.
 */
export async function request<T>(options: RequestOptions): Promise<Fetched<T>> {
  const mode = getDataMode();
  const method = options.method ?? 'GET';
  const key = cacheKey(options.upstream, method, options.path, options.body);

  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      data: cached.value.data as T,
      provenance: { ...cached.value.provenance, origin: 'memory-cache' },
    } satisfies Fetched<T>;
  }

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<Fetched<T>>;

  const url = mode === 'snapshot' ? `/data/${key}.json` : resolveUrl(options.upstream, options.path, mode);

  const run = (async (): Promise<Fetched<T>> => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort);

      try {
        const raw =
          mode === 'snapshot'
            ? await fetchOnce(url, { ...options, method: 'GET', body: undefined }, controller.signal)
            : await fetchOnce(url, options, controller.signal);

        const value: Fetched<T> = {
          data: raw as T,
          provenance: {
            sourceId: options.sourceId,
            url: citationUrl(options.upstream, options.path),
            method,
            requestBody: options.body,
            retrievedAt: new Date().toISOString(),
            origin: mode === 'snapshot' ? 'snapshot' : 'network',
          },
        };
        memoryCache.set(key, { expiresAt: Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS), value });
        return value;
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof ApiError ? error.status === undefined || isRetryable(error.status) : true;
        const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
        if (!retryable || isLastAttempt || options.signal?.aborted) break;
        await sleep(RETRY_DELAYS_MS[attempt] ?? 1000);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }

    if (lastError instanceof ApiError) throw lastError;
    throw new ApiError(
      `${method} ${url} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      url,
    );
  })();

  inFlight.set(key, run as Promise<Fetched<unknown>>);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}
