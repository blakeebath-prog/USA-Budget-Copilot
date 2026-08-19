import { describe, expect, it } from 'vitest';
import { upstreamTarget } from './_proxy.js';

const USASPENDING = 'https://api.usaspending.gov';
const FISCALDATA = 'https://api.fiscaldata.treasury.gov';

const request = (url) => ({ url });

describe('upstreamTarget', () => {
  it('strips the proxy prefix and keeps the rest of the path', () => {
    expect(
      upstreamTarget(request('/api/fiscaldata/services/api/fiscal_service/v2/accounting/od/debt_to_penny'), '/api/fiscaldata', FISCALDATA),
    ).toBe(`${FISCALDATA}/services/api/fiscal_service/v2/accounting/od/debt_to_penny`);
  });

  it('preserves the query string verbatim, brackets and all', () => {
    const target = upstreamTarget(
      request('/api/fiscaldata/services/api/fiscal_service/v1/accounting/mts/mts_table_1?filter=record_date:gte:2024-10-01&page[size]=5000'),
      '/api/fiscaldata',
      FISCALDATA,
    );
    expect(target).toContain('page[size]=5000');
    expect(target).toContain('filter=record_date:gte:2024-10-01');
  });

  it('restores the trailing slash USAspending requires', () => {
    // Without this the API 301-redirects, and a redirected POST becomes a GET
    // with no body — the request silently turns into the wrong request.
    expect(
      upstreamTarget(request('/api/usaspending/api/v2/spending'), '/api/usaspending', USASPENDING, {
        requireTrailingSlash: true,
      }),
    ).toBe(`${USASPENDING}/api/v2/spending/`);
  });

  it('leaves an existing trailing slash alone', () => {
    expect(
      upstreamTarget(request('/api/usaspending/api/v2/spending/?x=1'), '/api/usaspending', USASPENDING, {
        requireTrailingSlash: true,
      }),
    ).toBe(`${USASPENDING}/api/v2/spending/?x=1`);
  });

  it('refuses a path outside its own prefix', () => {
    expect(upstreamTarget(request('/api/other/thing'), '/api/usaspending', USASPENDING)).toBeNull();
  });

  it('refuses traversal segments', () => {
    expect(
      upstreamTarget(request('/api/usaspending/../../etc/passwd'), '/api/usaspending', USASPENDING),
    ).toBeNull();
  });

  it('cannot be pointed at another host by the request', () => {
    const target = upstreamTarget(
      request('/api/usaspending/api/v2/x/?redirect=https://evil.example'),
      '/api/usaspending',
      USASPENDING,
      { requireTrailingSlash: true },
    );
    expect(target.startsWith(`${USASPENDING}/`)).toBe(true);
  });
});
