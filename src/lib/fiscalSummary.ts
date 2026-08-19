import type { MonthlyFlow } from './api/fiscalData';
import { fiscalPeriodFromDate } from './fiscalYear';

export interface FiscalYearToDate {
  receipts: number;
  outlays: number;
  surplusOrDeficit: number;
  monthsReported: number;
}

/**
 * Sum a fiscal year through the months actually reported.
 *
 * `limitMonths` is what makes a year-over-year comparison honest: setting eight
 * months of this year against twelve of last year is the classic way to
 * manufacture a scary number, so the prior year is truncated to the same point
 * in its own fiscal year before the two are compared.
 */
export function summariseFiscalYearToDate(
  flows: readonly MonthlyFlow[],
  fiscalYear: number,
  limitMonths?: number,
): FiscalYearToDate | null {
  const rows = flows
    .filter((flow) => flow.fiscalYear === fiscalYear)
    .sort((a, b) => a.recordDate.localeCompare(b.recordDate));
  if (rows.length === 0) return null;

  const capped =
    limitMonths === undefined
      ? rows
      : rows.filter((flow) => fiscalPeriodFromDate(flow.recordDate).fiscalMonth <= limitMonths);
  if (capped.length === 0) return null;

  return capped.reduce<FiscalYearToDate>(
    (accumulator, flow) => ({
      receipts: accumulator.receipts + (Number.isFinite(flow.receipts) ? flow.receipts : 0),
      outlays: accumulator.outlays + (Number.isFinite(flow.outlays) ? flow.outlays : 0),
      surplusOrDeficit:
        accumulator.surplusOrDeficit + (Number.isFinite(flow.surplusOrDeficit) ? flow.surplusOrDeficit : 0),
      monthsReported: accumulator.monthsReported + 1,
    }),
    { receipts: 0, outlays: 0, surplusOrDeficit: 0, monthsReported: 0 },
  );
}
