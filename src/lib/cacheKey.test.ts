import { describe, expect, it } from 'vitest';
import { cacheKey, fnv1a, stableStringify } from '../../shared/cacheKey.mjs';

/**
 * These vectors are load-bearing. The browser computes a key to look up
 * /data/<key>.json and the ingest script computes one to name the file it
 * writes; if the algorithm drifts, snapshot mode silently 404s every panel.
 */
describe('cacheKey', () => {
  it('is stable for a known request', () => {
    expect(cacheKey('fiscaldata', 'GET', '/v1/accounting/mts/mts_table_1?format=json')).toBe(
      'fiscaldata-e0f82d59',
    );
  });

  it('ignores the order keys were written in the body', () => {
    const a = cacheKey('usaspending', 'POST', '/api/v2/spending/', { type: 'budget_function', filters: { fy: '2024', quarter: '4' } });
    const b = cacheKey('usaspending', 'POST', '/api/v2/spending/', { filters: { quarter: '4', fy: '2024' }, type: 'budget_function' });
    expect(a).toBe(b);
  });

  it('separates requests that differ only in the body', () => {
    const a = cacheKey('usaspending', 'POST', '/api/v2/spending/', { filters: { fy: '2024' } });
    const b = cacheKey('usaspending', 'POST', '/api/v2/spending/', { filters: { fy: '2025' } });
    expect(a).not.toBe(b);
  });

  it('separates the two upstreams even for identical paths', () => {
    expect(cacheKey('usaspending', 'GET', '/x')).not.toBe(cacheKey('fiscaldata', 'GET', '/x'));
  });

  it('treats a GET and a POST of the same path as different requests', () => {
    expect(cacheKey('usaspending', 'GET', '/x')).not.toBe(cacheKey('usaspending', 'POST', '/x'));
  });
});

describe('stableStringify', () => {
  it('sorts keys at every depth', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
  });

  it('handles null and primitives', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('x')).toBe('"x"');
  });
});

describe('fnv1a', () => {
  it('produces eight hex characters', () => {
    expect(fnv1a('anything')).toMatch(/^[0-9a-f]{8}$/);
  });
});
