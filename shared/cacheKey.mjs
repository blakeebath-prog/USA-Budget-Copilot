/**
 * Deterministic key for one upstream request.
 *
 * Shared verbatim between the browser data layer (src/lib/http.ts) and the
 * offline snapshot writer (scripts/ingest.mjs) so that a snapshot fetched by
 * Node is found by the same request issued in the browser. Do not change the
 * algorithm without regenerating snapshots — src/lib/cacheKey.test.ts pins it.
 *
 * @param {string} upstream  'usaspending' | 'fiscaldata'
 * @param {string} method    HTTP method
 * @param {string} path      path + query string, no host
 * @param {unknown} [body]   JSON request body, if any
 * @returns {string}
 */
export function cacheKey(upstream, method, path, body) {
  const canonical = [upstream, method.toUpperCase(), path, body === undefined ? '' : stableStringify(body)].join(
    '\n',
  );
  return `${upstream}-${fnv1a(canonical)}`;
}

/** JSON.stringify with object keys sorted, so key order never changes the hash. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** 32-bit FNV-1a, hex encoded. Not cryptographic — only needs to be stable. */
export function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
