import { describe, expect, it } from 'vitest';
import { summariseFiscalYearToDate } from './fiscalSummary';
import type { MonthlyFlow } from './api/fiscalData';

const flow = (recordDate: string, fiscalYear: number, receipts: number, outlays: number): MonthlyFlow => ({
  recordDate,
  fiscalYear,
  receipts,
  outlays,
  surplusOrDeficit: receipts - outlays,
});

const series: MonthlyFlow[] = [
  flow('2024-10-31', 2025, 100, 200),
  flow('2024-11-30', 2025, 100, 200),
  flow('2024-12-31', 2025, 100, 200),
  flow('2025-01-31', 2025, 100, 200),
  flow('2025-10-31', 2026, 150, 250),
  flow('2025-11-30', 2026, 150, 250),
];

describe('summariseFiscalYearToDate', () => {
  it('sums only the requested fiscal year', () => {
    expect(summariseFiscalYearToDate(series, 2026)).toEqual({
      receipts: 300,
      outlays: 500,
      surplusOrDeficit: -200,
      monthsReported: 2,
    });
  });

  it('truncates the prior year to the same point, so the comparison is like for like', () => {
    const currentYear = summariseFiscalYearToDate(series, 2026);
    const priorYear = summariseFiscalYearToDate(series, 2025, currentYear?.monthsReported);

    expect(priorYear?.monthsReported).toBe(2);
    expect(priorYear?.outlays).toBe(400);
  });

  it('returns null for a year with nothing reported', () => {
    expect(summariseFiscalYearToDate(series, 2019)).toBeNull();
  });

  it('ignores non-finite months instead of poisoning the sum with NaN', () => {
    const withGap: MonthlyFlow[] = [
      ...series,
      { recordDate: '2025-12-31', fiscalYear: 2026, receipts: Number.NaN, outlays: 100, surplusOrDeficit: Number.NaN },
    ];
    const summary = summariseFiscalYearToDate(withGap, 2026);
    expect(summary?.receipts).toBe(300);
    expect(summary?.outlays).toBe(600);
    expect(summary?.monthsReported).toBe(3);
  });
});
