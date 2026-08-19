import { describe, expect, it } from 'vitest';
import { foldAgencies, foldAgencyYears, foldCategoryRows, foldExplorer, foldSpendingOverTime } from './usaspending';

describe('foldAgencies', () => {
  it('reads the reported measures and ranks by budgetary resources', () => {
    const agencies = foldAgencies([
      {
        agency_id: 1,
        toptier_code: '097',
        abbreviation: 'DOD',
        agency_name: 'Department of Defense',
        active_fy: '2025',
        active_fq: '4',
        budget_authority_amount: 1000,
        obligated_amount: 800,
        outlay_amount: 700,
        percentage_of_total_budget_authority: 0.12,
        agency_slug: 'department-of-defense',
      },
      {
        agency_id: 2,
        toptier_code: '075',
        abbreviation: 'HHS',
        agency_name: 'Department of Health and Human Services',
        active_fy: '2025',
        active_fq: '4',
        budget_authority_amount: 2000,
        obligated_amount: 1900,
        outlay_amount: 1800,
        percentage_of_total_budget_authority: 0.24,
        agency_slug: null,
      },
    ]);

    expect(agencies.map((agency) => agency.abbreviation)).toEqual(['HHS', 'DOD']);
    expect(agencies[1]?.budgetAuthority).toBe(1000);
    expect(agencies[0]?.slug).toBeNull();
  });

  it('drops rows with no agency name rather than rendering a blank bar', () => {
    expect(foldAgencies([{ agency_name: '', budget_authority_amount: 5 }])).toHaveLength(0);
  });
});

describe('foldAgencyYears', () => {
  it('falls back to the alternate resources field and sorts ascending', () => {
    const years = foldAgencyYears([
      { fiscal_year: 2025, total_budgetary_resources: 300, agency_total_obligated: 250 },
      { fiscal_year: 2024, agency_budgetary_resources: 200, agency_total_obligated: 150 },
    ]);
    expect(years.map((year) => year.fiscalYear)).toEqual([2024, 2025]);
    expect(years[1]?.budgetaryResources).toBe(300);
  });
});

describe('foldExplorer', () => {
  it('sorts nodes by amount and keeps the reported total', () => {
    const result = foldExplorer({
      total: 1000,
      end_date: '2025-09-30',
      results: [
        { id: '1', code: '550', name: 'Health', amount: 300 },
        { id: '2', code: '050', name: 'National Defense', amount: 700 },
      ],
    });
    expect(result.nodes.map((node) => node.name)).toEqual(['National Defense', 'Health']);
    expect(result.total).toBe(1000);
    expect(result.endDate).toBe('2025-09-30');
  });

  it('derives a total when the response omits one', () => {
    const result = foldExplorer({ results: [{ name: 'A', amount: 4 }, { name: 'B', amount: 6 }] });
    expect(result.total).toBe(10);
  });

  it('labels an unnamed node rather than rendering "undefined"', () => {
    expect(foldExplorer({ results: [{ amount: 1 }] }).nodes[0]?.name).toBe('Unspecified');
  });
});

describe('foldCategoryRows', () => {
  it('ranks recipients and names an unreported one', () => {
    const rows = foldCategoryRows([
      { id: 1, code: 'X', name: 'Small Co', amount: 10 },
      { id: 2, code: 'Y', amount: 90 },
    ]);
    expect(rows[0]?.amount).toBe(90);
    expect(rows[0]?.name).toBe('Unreported');
  });
});

describe('foldSpendingOverTime', () => {
  it('labels fiscal years and quarters and orders them', () => {
    const points = foldSpendingOverTime([
      { time_period: { fiscal_year: '2025', quarter: '2' }, aggregated_amount: 20 },
      { time_period: { fiscal_year: '2025', quarter: '1' }, aggregated_amount: 10 },
      { time_period: { fiscal_year: '2024' }, aggregated_amount: 5 },
    ]);
    expect(points.map((point) => point.label)).toEqual(['FY2024', 'FY2025 Q1', 'FY2025 Q2']);
  });

  it('drops rows with no usable period', () => {
    expect(foldSpendingOverTime([{ time_period: {}, aggregated_amount: 1 }])).toHaveLength(0);
  });
});
