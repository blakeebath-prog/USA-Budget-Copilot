import { describe, expect, it } from 'vitest';
import { foldCategories, foldDebt, foldFiscalYears, foldMonthlyFlows } from './fiscalData';
import { SchemaMismatchError } from './fieldResolution';

const monthRows = (recordDate: string, fiscalYear: string, receipts: string, outlays: string, deficit: string) => [
  {
    record_date: recordDate,
    record_fiscal_year: fiscalYear,
    classification_desc: 'Total Receipts',
    current_month_gross_rcpt_amt: receipts,
  },
  {
    record_date: recordDate,
    record_fiscal_year: fiscalYear,
    classification_desc: 'Total Outlays',
    current_month_gross_outly_amt: outlays,
  },
  {
    record_date: recordDate,
    record_fiscal_year: fiscalYear,
    classification_desc: 'Total Surplus (+) or Deficit (-)',
    current_month_dfct_sur_amt: deficit,
  },
];

describe('foldMonthlyFlows', () => {
  it('folds the three summary lines into one row per month', () => {
    const flows = foldMonthlyFlows([
      ...monthRows('2025-10-31', '2026', '400', '700', '-300'),
      ...monthRows('2025-11-30', '2026', '300', '600', '-300'),
    ]);

    expect(flows).toHaveLength(2);
    expect(flows[0]).toEqual({
      recordDate: '2025-10-31',
      fiscalYear: 2026,
      receipts: 400,
      outlays: 700,
      surplusOrDeficit: -300,
    });
  });

  it('ignores classification lines that are not the summary totals', () => {
    const flows = foldMonthlyFlows([
      ...monthRows('2025-10-31', '2026', '400', '700', '-300'),
      {
        record_date: '2025-10-31',
        record_fiscal_year: '2026',
        classification_desc: 'Individual Income Taxes',
        current_month_gross_rcpt_amt: '999999',
      },
    ]);
    expect(flows[0]?.receipts).toBe(400);
  });

  it('derives the balance when the deficit line is missing rather than dropping the month', () => {
    const rows = monthRows('2025-10-31', '2026', '400', '700', '-300').slice(0, 2);
    expect(foldMonthlyFlows(rows)[0]?.surplusOrDeficit).toBe(-300);
  });

  it('returns months in chronological order regardless of input order', () => {
    const flows = foldMonthlyFlows([
      ...monthRows('2025-12-31', '2026', '1', '2', '-1'),
      ...monthRows('2025-10-31', '2026', '1', '2', '-1'),
    ]);
    expect(flows.map((flow) => flow.recordDate)).toEqual(['2025-10-31', '2025-12-31']);
  });
});

describe('foldFiscalYears', () => {
  it('sums months into fiscal years and counts how many reported', () => {
    const flows = foldMonthlyFlows([
      ...monthRows('2025-10-31', '2026', '400', '700', '-300'),
      ...monthRows('2025-11-30', '2026', '300', '600', '-300'),
      ...monthRows('2024-10-31', '2025', '100', '200', '-100'),
    ]);

    const years = foldFiscalYears(flows);
    expect(years).toEqual([
      { fiscalYear: 2025, receipts: 100, outlays: 200, surplusOrDeficit: -100, monthsReported: 1 },
      { fiscalYear: 2026, receipts: 700, outlays: 1300, surplusOrDeficit: -600, monthsReported: 2 },
    ]);
  });
});

describe('foldMonthlyFlows label tolerance', () => {
  const withLabels = (receipts: string, outlays: string, deficit: string) => [
    { record_date: '2026-07-31', record_fiscal_year: '2026', classification_desc: receipts, current_month_gross_rcpt_amt: '400' },
    { record_date: '2026-07-31', record_fiscal_year: '2026', classification_desc: outlays, current_month_gross_outly_amt: '700' },
    { record_date: '2026-07-31', record_fiscal_year: '2026', classification_desc: deficit, current_month_dfct_sur_amt: '-300' },
  ];

  it('matches the double-dash spelling of the same lines', () => {
    const flows = foldMonthlyFlows(withLabels('Total--Receipts', 'Total--Outlays', 'Total--Surplus (+) or Deficit (-)'));
    expect(flows[0]).toMatchObject({ receipts: 400, outlays: 700, surplusOrDeficit: -300 });
  });

  it('matches an em-dash spelling and stray spacing', () => {
    const flows = foldMonthlyFlows(withLabels('Total — Receipts', '  Total   Outlays ', 'Surplus (+) or Deficit (-)'));
    expect(flows[0]).toMatchObject({ receipts: 400, outlays: 700, surplusOrDeficit: -300 });
  });

  it('matches the bare and budget-prefixed spellings', () => {
    const flows = foldMonthlyFlows(withLabels('Receipts', 'Budget Outlays', 'Budget Surplus or Deficit'));
    expect(flows[0]).toMatchObject({ receipts: 400, outlays: 700, surplusOrDeficit: -300 });
  });

  it('still ignores a detail line that merely mentions receipts', () => {
    const flows = foldMonthlyFlows([
      ...withLabels('Total Receipts', 'Total Outlays', 'Total Surplus (+) or Deficit (-)'),
      {
        record_date: '2026-07-31',
        record_fiscal_year: '2026',
        classification_desc: 'Miscellaneous Receipts of the Treasury',
        current_month_gross_rcpt_amt: '999999',
      },
    ]);
    expect(flows[0]?.receipts).toBe(400);
  });

  it('throws naming the real labels when nothing matches, rather than charting nothing', () => {
    // The failure this replaces: an empty chart that looked like "no data".
    let thrown: unknown;
    try {
      foldMonthlyFlows([
        { record_date: '2026-07-31', classification_desc: 'Something Unexpected', current_month_gross_rcpt_amt: '1' },
        { record_date: '2026-07-31', classification_desc: 'Another Line', current_month_gross_rcpt_amt: '2' },
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchemaMismatchError);
    expect((thrown as Error).message).toContain('Something Unexpected');
    expect((thrown as Error).message).toContain('Another Line');
  });

  it('returns an empty list when the feed itself returned nothing', () => {
    expect(foldMonthlyFlows([])).toEqual([]);
  });
});

describe('foldCategories', () => {
  const rows = [
    { record_date: '2025-09-30', classification_desc: 'Department of Defense', current_fytd_net_outly_amt: '900' },
    { record_date: '2025-09-30', classification_desc: 'Department of Energy', current_fytd_net_outly_amt: '100' },
    { record_date: '2025-09-30', classification_desc: 'Total Outlays', current_fytd_net_outly_amt: '1000' },
    { record_date: '2025-08-31', classification_desc: 'Department of Defense', current_fytd_net_outly_amt: '800' },
  ];

  it('keeps only the most recent record date, so months are not summed twice', () => {
    const folded = foldCategories(rows, 'ctx');
    expect(folded.every((row) => row.recordDate === '2025-09-30')).toBe(true);
  });

  it('drops roll-up rows that would double-count against their children', () => {
    expect(foldCategories(rows, 'ctx').map((row) => row.label)).toEqual([
      'Department of Defense',
      'Department of Energy',
    ]);
  });

  it('sorts by magnitude so a large negative category is not buried', () => {
    const folded = foldCategories(
      [
        { record_date: '2025-09-30', classification_desc: 'Small', current_fytd_net_rcpt_amt: '5' },
        { record_date: '2025-09-30', classification_desc: 'Big refund', current_fytd_net_rcpt_amt: '-900' },
      ],
      'ctx',
    );
    expect(folded[0]?.label).toBe('Big refund');
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

describe('foldCategories hierarchy', () => {
  // The shape that broke the first deployment: department totals and their
  // constituent account lines arrive as sibling rows, so a flat read puts
  // individual accounts ahead of whole departments.
  const nested = [
    { record_date: '2026-07-31', classification_desc: 'Department of Defense', current_fytd_net_outly_amt: '900', parent_id: null },
    { record_date: '2026-07-31', classification_desc: 'Military Personnel', current_fytd_net_outly_amt: '400', parent_id: '12' },
    { record_date: '2026-07-31', classification_desc: 'Operation and Maintenance', current_fytd_net_outly_amt: '350', parent_id: '12' },
    { record_date: '2026-07-31', classification_desc: 'Department of Energy', current_fytd_net_outly_amt: '100', parent_id: '' },
  ];

  it('keeps top-level categories and drops the nested detail', () => {
    expect(foldCategories(nested, 'ctx').map((row) => row.label)).toEqual([
      'Department of Defense',
      'Department of Energy',
    ]);
  });

  it('falls back to the flat list when the feed carries no parent column', () => {
    const flat = [
      { record_date: '2026-07-31', classification_desc: 'Individual Income Taxes', current_fytd_net_rcpt_amt: '500' },
      { record_date: '2026-07-31', classification_desc: 'Corporation Income Taxes', current_fytd_net_rcpt_amt: '200' },
    ];
    expect(foldCategories(flat, 'ctx')).toHaveLength(2);
  });

  it('falls back rather than emptying the panel when every row is nested', () => {
    const allChildren = nested.filter((row) => row.parent_id === '12');
    expect(foldCategories(allChildren, 'ctx')).toHaveLength(2);
  });

  it('throws naming the real labels when nothing is chartable', () => {
    let thrown: unknown;
    try {
      foldCategories(
        [{ record_date: '2026-07-31', classification_desc: 'Total Receipts', current_fytd_net_rcpt_amt: '5' }],
        'MTS Table 4',
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchemaMismatchError);
    expect((thrown as Error).message).toContain('Total Receipts');
  });
});
