/**
 * Federal fiscal-year arithmetic.
 *
 * The federal fiscal year runs October 1 through September 30 and is named for
 * the calendar year it ends in: October 2025 is the first month of FY2026. Every
 * "year" in this app is a fiscal year unless a label says otherwise, because
 * that is how the underlying feeds report.
 */

export interface FiscalPeriod {
  fiscalYear: number;
  /** 1 = October, 12 = September. */
  fiscalMonth: number;
  /** 1–4, where Q1 is October–December. */
  fiscalQuarter: number;
}

export function fiscalPeriodFromDate(isoDate: string): FiscalPeriod {
  const parts = isoDate.split('-');
  const calendarYear = Number(parts[0]);
  const calendarMonth = Number(parts[1]);
  if (!Number.isFinite(calendarYear) || !Number.isFinite(calendarMonth)) {
    throw new Error(`Not an ISO date: ${isoDate}`);
  }
  const fiscalYear = calendarMonth >= 10 ? calendarYear + 1 : calendarYear;
  const fiscalMonth = calendarMonth >= 10 ? calendarMonth - 9 : calendarMonth + 3;
  return { fiscalYear, fiscalMonth, fiscalQuarter: Math.ceil(fiscalMonth / 3) };
}

export function fiscalYearOf(isoDate: string): number {
  return fiscalPeriodFromDate(isoDate).fiscalYear;
}

/** Calendar bounds of a fiscal year, as ISO dates. */
export function fiscalYearBounds(fiscalYear: number): { start: string; end: string } {
  return { start: `${fiscalYear - 1}-10-01`, end: `${fiscalYear}-09-30` };
}

/** The fiscal year currently in progress, from the caller's clock. */
export function currentFiscalYear(now: Date = new Date()): number {
  const month = now.getUTCMonth() + 1;
  return month >= 10 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

/**
 * The newest fiscal year worth offering in a picker.
 *
 * Agency financial data lands a quarter or more behind, so defaulting a
 * selector to the fiscal year in progress usually lands on an empty or badly
 * partial quarter. The previous completed year is the honest default.
 */
export function latestCompleteFiscalYear(now: Date = new Date()): number {
  return currentFiscalYear(now) - 1;
}

export function fiscalYearRange(count: number, endingAt: number = latestCompleteFiscalYear()): number[] {
  return Array.from({ length: count }, (_, index) => endingAt - count + 1 + index);
}

const FISCAL_MONTH_NAMES = [
  'Oct',
  'Nov',
  'Dec',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
] as const;

export function fiscalMonthName(fiscalMonth: number): string {
  return FISCAL_MONTH_NAMES[fiscalMonth - 1] ?? '?';
}
