import { describe, expect, it } from 'vitest';
import {
  currentFiscalYear,
  fiscalMonthName,
  fiscalPeriodFromDate,
  fiscalYearBounds,
  fiscalYearOf,
  fiscalYearRange,
  latestCompleteFiscalYear,
} from './fiscalYear';

describe('fiscalPeriodFromDate', () => {
  it('puts October in the next fiscal year', () => {
    expect(fiscalPeriodFromDate('2025-10-31')).toEqual({ fiscalYear: 2026, fiscalMonth: 1, fiscalQuarter: 1 });
  });

  it('puts September at the end of its own fiscal year', () => {
    expect(fiscalPeriodFromDate('2026-09-30')).toEqual({ fiscalYear: 2026, fiscalMonth: 12, fiscalQuarter: 4 });
  });

  it('maps January to the fourth fiscal month, second quarter', () => {
    expect(fiscalPeriodFromDate('2026-01-31')).toEqual({ fiscalYear: 2026, fiscalMonth: 4, fiscalQuarter: 2 });
  });

  it('rejects a value that is not an ISO date', () => {
    expect(() => fiscalPeriodFromDate('not-a-date')).toThrow(/Not an ISO date/);
  });
});

describe('fiscalYearOf', () => {
  it('agrees with the period calculation across a year boundary', () => {
    expect(fiscalYearOf('2024-09-30')).toBe(2024);
    expect(fiscalYearOf('2024-10-01')).toBe(2025);
  });
});

describe('fiscalYearBounds', () => {
  it('spans October 1 of the prior calendar year to September 30', () => {
    expect(fiscalYearBounds(2025)).toEqual({ start: '2024-10-01', end: '2025-09-30' });
  });
});

describe('currentFiscalYear', () => {
  it('rolls over on October 1', () => {
    expect(currentFiscalYear(new Date('2025-09-30T12:00:00Z'))).toBe(2025);
    expect(currentFiscalYear(new Date('2025-10-01T12:00:00Z'))).toBe(2026);
  });
});

describe('latestCompleteFiscalYear', () => {
  it('is the year before the one in progress, since agency data lags', () => {
    expect(latestCompleteFiscalYear(new Date('2026-08-19T00:00:00Z'))).toBe(2025);
  });
});

describe('fiscalYearRange', () => {
  it('returns ascending years ending at the given year', () => {
    expect(fiscalYearRange(4, 2025)).toEqual([2022, 2023, 2024, 2025]);
  });
});

describe('fiscalMonthName', () => {
  it('starts the year in October', () => {
    expect(fiscalMonthName(1)).toBe('Oct');
    expect(fiscalMonthName(12)).toBe('Sep');
    expect(fiscalMonthName(99)).toBe('?');
  });
});
