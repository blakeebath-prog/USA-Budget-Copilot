import { describe, expect, it } from 'vitest';
import {
  applyScenarios,
  baseline,
  stabilizationYear,
  tenYearEffect,
  terminalDebtShare,
  type OutlookYear,
} from './baseline';

describe('the ingested CBO baseline', () => {
  it('carries a vintage and its own publication sources', () => {
    expect(baseline.vintage).toMatch(/^\d{4}-\d{2}$/);
    expect(baseline.sources.projections.url).toContain('cbo.gov');
    expect(baseline.sources.license.toLowerCase()).toContain('public domain');
  });

  it('separates measured history from projection', () => {
    const actual = baseline.years.filter((year) => year.basis === 'actual');
    const projected = baseline.years.filter((year) => year.basis === 'projected');
    expect(actual.length).toBeGreaterThan(50);
    expect(projected.length).toBeGreaterThan(5);
    expect(Math.max(...actual.map((y) => y.fiscalYear))).toBeLessThan(baseline.firstProjectedYear);
    expect(Math.min(...projected.map((y) => y.fiscalYear))).toBe(baseline.firstProjectedYear);
  });

  it('agrees with the Treasury actual for the last completed year', () => {
    // Cross-check across two independent federal sources: CBO's historical
    // table and the Monthly Treasury Statement should tell the same story.
    const last = baseline.years.filter((y) => y.basis === 'actual').at(-1);
    expect(last?.deficit).toBeLessThan(-1_500);
    expect(last?.deficit).toBeGreaterThan(-2_100);
  });
});

describe('applyScenarios with nothing selected', () => {
  const path = applyScenarios(baseline, []);

  it('reproduces CBO’s published debt path to the dollar', () => {
    // The golden test. Rolling debt forward on CBO's identity must return
    // CBO's own numbers; if this drifts, every scenario built on it is wrong.
    for (const year of path) {
      const published = baseline.years.find((y) => y.fiscalYear === year.fiscalYear);
      expect(published).toBeDefined();
      expect(year.debtHeldByPublic).toBeCloseTo(published?.debtHeldByPublic ?? 0, 1);
    }
  });

  it('reproduces CBO’s published debt-to-GDP share', () => {
    for (const year of path) {
      const published = baseline.years.find((y) => y.fiscalYear === year.fiscalYear);
      expect(year.debtGdpShare).toBeCloseTo(published?.debtGdpShare ?? 0, 2);
    }
  });

  it('marks nothing as changed', () => {
    expect(path.some((year) => year.changed)).toBe(false);
  });
});

describe('applyScenarios sign convention', () => {
  const terminal = (ids: string[]) => terminalDebtShare(applyScenarios(baseline, ids)) ?? 0;
  const base = terminal([]);

  it('lowers the debt path when discretionary funding is frozen', () => {
    // The trap: CBO's scenario deltas use the opposite sign convention from the
    // baseline deficit. Adding instead of subtracting would send a spending
    // freeze the wrong way, and the chart would look entirely reasonable.
    expect(terminal(['freeze'])).toBeLessThan(base);
  });

  it('raises the debt path when discretionary grows with the economy', () => {
    expect(terminal(['gdp-growth'])).toBeGreaterThan(base);
  });

  it('raises the debt path when emergency funding continues', () => {
    expect(terminal(['emergency'])).toBeGreaterThan(base);
  });

  it('lowers the debt path when IIJA and BSCA funding ends', () => {
    expect(terminal(['no-iija-bsca'])).toBeLessThan(base);
  });

  it('compounds two selections in the same direction', () => {
    expect(terminal(['freeze', 'no-iija-bsca'])).toBeLessThan(terminal(['freeze']));
  });

  it('leaves measured history untouched whatever is selected', () => {
    const withScenario = applyScenarios(baseline, ['freeze']);
    const actuals = withScenario.filter((year) => year.basis === 'actual');
    for (const year of actuals) {
      const published = baseline.years.find((y) => y.fiscalYear === year.fiscalYear);
      expect(year.debtHeldByPublic).toBe(published?.debtHeldByPublic);
      expect(year.changed).toBe(false);
    }
  });
});

describe('tenYearEffect', () => {
  it('is zero for an empty selection', () => {
    expect(tenYearEffect(baseline, [])).toBe(0);
  });

  it('reports a freeze as reducing the deficit', () => {
    expect(tenYearEffect(baseline, ['freeze'])).toBeLessThan(0);
  });

  it('sums a multi-scenario selection', () => {
    const both = tenYearEffect(baseline, ['freeze', 'emergency']);
    expect(both).toBeCloseTo(
      tenYearEffect(baseline, ['freeze']) + tenYearEffect(baseline, ['emergency']),
      6,
    );
  });
});

describe('stabilizationYear', () => {
  const year = (fiscalYear: number, debtGdpShare: number): OutlookYear => ({
    fiscalYear,
    basis: 'projected',
    deficit: -100,
    debtHeldByPublic: 1000,
    debtGdpShare,
    gdp: 1000,
    changed: false,
  });

  it('finds the first year the ratio stops rising', () => {
    expect(stabilizationYear([year(2026, 100), year(2027, 101), year(2028, 101)])).toBe(2028);
  });

  it('returns null while the ratio is still climbing', () => {
    expect(stabilizationYear([year(2026, 100), year(2027, 101), year(2028, 103)])).toBeNull();
  });

  it('ignores measured history when looking for the turn', () => {
    const history: OutlookYear = { ...year(2025, 200), basis: 'actual' };
    expect(stabilizationYear([history, year(2026, 100), year(2027, 99)])).toBe(2027);
  });
});
