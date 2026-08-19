import { createProxy } from '../_proxy.js';

/**
 * Proxy for api.usaspending.gov.
 *
 * Every v2 endpoint canonically ends in a slash and the API 301-redirects when
 * one is missing, which would silently downgrade a POST to a GET — so the
 * trailing slash is restored before the request goes out.
 */
export default createProxy({
  prefix: '/api/usaspending',
  host: 'https://api.usaspending.gov',
  requireTrailingSlash: true,
});
