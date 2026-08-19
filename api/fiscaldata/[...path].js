import { createProxy } from '../_proxy.js';

/**
 * Proxy for api.fiscaldata.treasury.gov.
 *
 * Fiscal Data endpoints end at the dataset name with no trailing slash, so the
 * path is forwarded exactly as received.
 */
export default createProxy({
  prefix: '/api/fiscaldata',
  host: 'https://api.fiscaldata.treasury.gov',
});
