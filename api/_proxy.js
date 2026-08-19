/**
 * Shared handler for the two government-API proxies.
 *
 * These exist as a fallback for `VITE_DATA_MODE=proxy`. The default production
 * mode is `direct` — the browser calls the APIs itself, which costs nothing and
 * adds no latency. Switch to proxy mode only if the browser turns out to be
 * blocked by CORS or by a corporate network that allows your own domain but not
 * api.usaspending.gov.
 *
 * Deliberately narrow, because a proxy that forwards anywhere is an open relay
 * someone else will find and abuse:
 *
 *   - the upstream host is fixed per route and never taken from the request
 *   - only GET and POST are accepted; everything else is refused
 *   - only a small allowlist of headers is forwarded, so cookies, Authorization,
 *     and anything else ambient never reach a government API
 *   - the request body is capped, so this cannot be used to relay bulk uploads
 */

const MAX_BODY_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 60_000;

/** Nothing else is forwarded upstream. */
const FORWARDED_REQUEST_HEADERS = ['accept', 'content-type'];

/** Everything else the upstream sends is dropped, including any Set-Cookie. */
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

/**
 * Rebuild the upstream path from the incoming request.
 *
 * `req.url` is used rather than the parsed catch-all segments because it
 * preserves the path exactly, trailing slash included. That matters: every
 * USAspending v2 endpoint canonically ends in a slash, and without it the API
 * answers with a 301 redirect that turns a POST into a GET and loses the body.
 */
export function upstreamTarget(req, prefix, host, { requireTrailingSlash } = {}) {
  const raw = req.url ?? '';
  const parsed = new URL(raw, 'http://internal');

  if (!parsed.pathname.startsWith(prefix)) return null;
  let pathname = parsed.pathname.slice(prefix.length) || '/';
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  if (requireTrailingSlash && !pathname.endsWith('/')) pathname = `${pathname}/`;

  // Path traversal cannot reach another host — the host is fixed — but a
  // normalized path keeps the upstream request honest.
  if (pathname.includes('..')) return null;

  return `${host}${pathname}${parsed.search}`;
}

function readBody(req) {
  if (req.method !== 'POST') return Promise.resolve(undefined);
  if (req.body !== undefined && req.body !== null) {
    return Promise.resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createProxy({ prefix, host, requireTrailingSlash = false }) {
  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ error: 'Only GET and POST are proxied.' });
      return;
    }

    const target = upstreamTarget(req, prefix, host, { requireTrailingSlash });
    if (!target) {
      res.status(400).json({ error: 'Unroutable proxy path.' });
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      res.status(413).json({ error: error.message });
      return;
    }

    const headers = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    if (!headers['accept']) headers['accept'] = 'application/json';

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
      }

      const payload = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status).send(payload);
    } catch (error) {
      // A failure here is this proxy's failure, not the government's. Say so —
      // the app surfaces the message, and "504" alone would send the reader
      // looking for an outage that isn't there.
      res.status(504).json({
        error: `Proxy could not reach ${host}: ${error instanceof Error ? error.message : String(error)}`,
        target,
      });
    }
  };
}
