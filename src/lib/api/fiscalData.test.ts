import { describe, expect, it } from 'vitest';
import { foldCategories, foldDebt, foldFiscalYears, foldMonthlyFlows } from './fiscalData';
import { SchemaMismatchError } from './fieldResolution';

/**
 * A real MTS Table 1 row: the period is the label, and receipts, outlays, and
 * the balance all sit in the same row.
 */
const monthRow = (
  recordDate: string,
  calendarMonth: string,
  label: string,
  fiscalYear: string,
  receipts: string,
  outlays: string,
  deficitMagnitude: string,
) => ({
  record_date: recordDate,
  record_calendar_month: calendarMonth,
  record_fiscal_year: fiscalYear,
  classification_desc: label,
  current_month_gross_rcpt_amt: receipts,
  current_month_gross_outly_amt: outlays,
  current_month_dfct_sur_amt: deficitMagnitude,
});

describe('foldMonthlyFlows', () => {
  it('reads one month from one row', () => {
    const flows = foldMonthlyFlows([
      monthRow('2024-10-31', '10', 'October', '2025', '326770236058.10', '584220579250.01', '257450343191.91'),
    ]);
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({
      recordDate: '2024-10-31',
      fiscalYear: 2025,
      receipts: 326770236058.1,
      outlays: 584220579250.01,
    });
    // Derived by subtraction, so it carries float residue at the cent level —
    // far below the billions this is ever displayed at.
    expect(flows[0]?.surplusOrDeficit).toBeCloseTo(-257450343191.91, 1);
  });

  it('signs a deficit negative even though the feed publishes it positive', () => {
    // Treasury reports current_month_dfct_sur_amt as a magnitude. Trusting its
    // sign turns every deficit in the series into a surplus of the same size.
    expect(foldMonthlyFlows([monthRow('2024-10-31', '10', 'October', '2025', '300', '500', '200')])[0]
      ?.surplusOrDeficit).toBe(-200);
  });

  it('reports a genuine surplus as positive', () => {
    expect(foldMonthlyFlows([monthRow('2025-04-30', '04', 'April', '2025', '900', '500', '400')])[0]
      ?.surplusOrDeficit).toBe(400);
  });

  it('ignores the roll-up rows that would be counted on top of their own months', () => {
    const flows = foldMonthlyFlows([
      monthRow('2024-10-31', '10', 'October', '2025', '300', '500', '200'),
      monthRow('2024-10-31', '10', 'Year-to-Date', '2025', '300', '500', '200'),
      monthRow('2024-10-31', '10', 'FY 2025', '2025', '5000000', '6000000', '1000000'),
      monthRow('2024-10-31', '10', 'FY 2024', '2024', '4900000', '5800000', '900000'),
    ]);
    expect(flows).toHaveLength(1);
    expect(flows[0]?.receipts).toBe(300);
  });

  it('ignores a month that is not the row\u2019s own record month', () => {
    const flows = foldMonthlyFlows([
      monthRow('2024-12-31', '12', 'October', '2025', '300', '500', '200'),
      monthRow('2024-12-31', '12', 'December', '2025', '400', '700', '300'),
    ]);
    expect(flows).toHaveLength(1);
    expect(flows[0]?.outlays).toBe(700);
  });

  it('keeps one row per calendar month across statements', () => {
    const flows = foldMonthlyFlows([
      monthRow('2024-10-31', '10', 'October', '2025', '300', '500', '200'),
      monthRow('2024-11-30', '11', 'November', '2025', '310', '520', '210'),
    ]);
    expect(flows.map((flow) => flow.recordDate)).toEqual(['2024-10-31', '2024-11-30']);
  });

  it('returns months in chronological order regardless of input order', () => {
    const flows = foldMonthlyFlows([
      monthRow('2024-12-31', '12', 'December', '2025', '1', '2', '1'),
      monthRow('2024-10-31', '10', 'October', '2025', '1', '2', '1'),
    ]);
    expect(flows.map((flow) => flow.recordDate)).toEqual(['2024-10-31', '2024-12-31']);
  });

  it('throws naming the real period labels when no month matches', () => {
    let thrown: unknown;
    try {
      foldMonthlyFlows([
        monthRow('2024-10-31', '10', 'Some New Label', '2025', '300', '500', '200'),
        monthRow('2024-10-31', '10', 'Another Label', '2025', '300', '500', '200'),
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchemaMismatchError);
    expect((thrown as Error).message).toContain('Some New Label');
  });

  it('returns an empty list when the feed itself returned nothing', () => {
    expect(foldMonthlyFlows([])).toEqual([]);
  });
});

describe('foldFiscalYears', () => {
  it('sums months into fiscal years and counts how many reported', () => {
    const flows = foldMonthlyFlows([
      monthRow('2024-10-31', '10', 'October', '2025', '100', '200', '100'),
      monthRow('2024-11-30', '11', 'November', '2025', '100', '200', '100'),
      monthRow('2025-10-31', '10', 'October', '2026', '150', '250', '100'),
    ]);
    expect(foldFiscalYears(flows)).toEqual([
      { fiscalYear: 2025, receipts: 200, outlays: 400, surplusOrDeficit: -200, monthsReported: 2 },
      { fiscalYear: 2026, receipts: 150, outlays: 250, surplusOrDeficit: -100, monthsReported: 1 },
    ]);
  });
});

describe('foldCategories', () => {
  // The real Table 4 shape: a section header with no amounts, its component
  // rows beneath it, and the section's actual figure in a "Total -- …" row.
  const table4 = [
    { record_date: '2025-09-30', classification_id: '1', parent_id: 'null', classification_desc: 'Individual Income Taxes', current_fytd_net_rcpt_amt: 'null', current_fytd_gross_rcpt_amt: 'null' },
    { record_date: '2025-09-30', classification_id: '2', parent_id: '1', classification_desc: 'Withheld', current_fytd_net_rcpt_amt: 'null', current_fytd_gross_rcpt_amt: '1919432792058.01' },
    { record_date: '2025-09-30', classification_id: '3', parent_id: '1', classification_desc: 'Other', current_fytd_net_rcpt_amt: 'null', current_fytd_gross_rcpt_amt: '500000000000' },
    { record_date: '2025-09-30', classification_id: '4', parent_id: '1', classification_desc: 'Total -- Individual Income Taxes', current_fytd_net_rcpt_amt: '2400000000000' },
    { record_date: '2025-09-30', classification_id: '5', parent_id: 'null', classification_desc: 'Corporation Income Taxes', current_fytd_net_rcpt_amt: '530000000000' },
    { record_date: '2025-09-30', classification_id: '6', parent_id: 'null', classification_desc: 'Total -- Receipts', current_fytd_net_rcpt_amt: '5000000000000' },
    { record_date: '2025-08-31', classification_id: '7', parent_id: 'null', classification_desc: 'Corporation Income Taxes', current_fytd_net_rcpt_amt: '480000000000' },
  ];

  it('resolves a section header to its own total row', () => {
    // The bug this replaces: "Total -- Individual Income Taxes" was discarded
    // as a roll-up, so the largest federal revenue source vanished entirely.
    const { categories } = foldCategories(table4, 'MTS Table 4');
    const individual = categories.find((row) => row.label === 'Individual Income Taxes');
    expect(individual?.amount).toBe(2_400_000_000_000);
  });

  it('does not chart a section beside its own components', () => {
    const { categories } = foldCategories(table4, 'MTS Table 4');
    expect(categories.map((row) => row.label)).toEqual(['Individual Income Taxes', 'Corporation Income Taxes']);
  });

  it('holds the grand total back but reports it separately', () => {
    const { categories, publishedTotal } = foldCategories(table4, 'MTS Table 4');
    expect(categories.some((row) => row.label.includes('Total'))).toBe(false);
    expect(publishedTotal).toBe(5_000_000_000_000);
  });

  it('keeps only the most recent record date, so months are not summed twice', () => {
    const { categories, recordDate } = foldCategories(table4, 'MTS Table 4');
    expect(recordDate).toBe('2025-09-30');
    expect(categories.find((row) => row.label === 'Corporation Income Taxes')?.amount).toBe(530_000_000_000);
  });

  it('excludes the on-budget and off-budget split, which re-counts everything', () => {
    const withSplit = [
      ...table4,
      { record_date: '2025-09-30', classification_id: '8', parent_id: 'null', classification_desc: 'Total -- On-Budget', current_fytd_net_rcpt_amt: '3900000000000' },
      { record_date: '2025-09-30', classification_id: '9', parent_id: 'null', classification_desc: 'Total -- Off-Budget', current_fytd_net_rcpt_amt: '1100000000000' },
    ];
    const { categories } = foldCategories(withSplit, 'MTS Table 4');
    expect(categories.map((row) => row.label)).toEqual(['Individual Income Taxes', 'Corporation Income Taxes']);
  });

  it('falls back to the flat list when the feed carries no hierarchy', () => {
    const flat = [
      { record_date: '2025-09-30', classification_desc: 'Customs Duties', current_fytd_net_rcpt_amt: '154000000000' },
      { record_date: '2025-09-30', classification_desc: 'Estate and Gift Taxes', current_fytd_net_rcpt_amt: '34000000000' },
    ];
    expect(foldCategories(flat, 'ctx').categories).toHaveLength(2);
  });

  it('reads gross when a detail row reports a null net', () => {
    const grossOnly = [
      { record_date: '2025-09-30', classification_desc: 'Customs Duties', current_fytd_net_rcpt_amt: 'null', current_fytd_gross_rcpt_amt: '154000000000' },
    ];
    expect(foldCategories(grossOnly, 'ctx').categories[0]?.amount).toBe(154_000_000_000);
  });

  it('sorts by magnitude so a large negative category is not buried', () => {
    const withRefund = [
      { record_date: '2025-09-30', classification_desc: 'Small', current_fytd_net_rcpt_amt: '5' },
      { record_date: '2025-09-30', classification_desc: 'Big refund', current_fytd_net_rcpt_amt: '-900' },
    ];
    expect(foldCategories(withRefund, 'ctx').categories[0]?.label).toBe('Big refund');
  });

  it('throws naming the real labels when nothing is chartable', () => {
    let thrown: unknown;
    try {
      foldCategories(
        [{ record_date: '2025-09-30', classification_desc: 'Total -- Receipts', current_fytd_net_rcpt_amt: '5' }],
        'MTS Table 4',
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchemaMismatchError);
    expect((thrown as Error).message).toContain('Total -- Receipts');
  });
});

describe('foldDebt', () => {
  it('reads the three debt components and sorts chronologically', () => {
    const points = foldDebt([
      {
        record_date: '2026-01-02',
        debt_held_public_amt: '2',
        intragov_hold_amt: '1',
        tot_pub_debt_out_amt: '3',
      },
      {
        record_date: '2026-01-01',
        debt_held_public_amt: '1',
        intragov_hold_amt: '1',
        tot_pub_debt_out_amt: '2',
      },
    ]);
    expect(points.map((point) => point.recordDate)).toEqual(['2026-01-01', '2026-01-02']);
    expect(points[1]).toEqual({
      recordDate: '2026-01-02',
      heldByPublic: 2,
      intragovernmental: 1,
      total: 3,
    });
  });
});
