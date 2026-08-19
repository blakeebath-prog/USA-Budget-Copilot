import {
  agencyBudgetaryResourcesRequest,
  spendingByCategoryRequest,
  spendingExplorerRequest,
  spendingOverTimeRequest,
  toptierAgenciesRequest,
} from '../../../shared/requests.mjs';
import { request, type Fetched } from '../http';
import { toNumber, type Row } from './fieldResolution';

/**
 * Client for the USAspending.gov API v2.
 *
 *   base: https://api.usaspending.gov
 *   auth: none — no key, no registration; documented at https://api.usaspending.gov/
 *
 * USAspending is the government's own account-level and award-level feed. It is
 * the right source for "which agency, which account, which recipient". It is the
 * wrong source for headline receipts and outlays, which come from Treasury's
 * Monthly Treasury Statement instead.
 */

/* ------------------------------------------------------------------ *
 * Agencies
 * ------------------------------------------------------------------ */

export interface ToptierAgency {
  agencyId: number;
  toptierCode: string;
  abbreviation: string;
  name: string;
  activeFy: string;
  activeFq: string;
  budgetAuthority: number;
  obligated: number;
  outlay: number;
  shareOfBudgetAuthority: number;
  /** Slug used by usaspending.gov's own agency profile pages. */
  slug: string | null;
}

interface ToptierAgencyResponse {
  results?: Row[];
}

export function foldAgencies(rows: Row[]): ToptierAgency[] {
  return rows
    .map((row) => ({
      agencyId: toNumber(row['agency_id']),
      toptierCode: String(row['toptier_code'] ?? ''),
      abbreviation: String(row['abbreviation'] ?? ''),
      name: String(row['agency_name'] ?? ''),
      activeFy: String(row['active_fy'] ?? ''),
      activeFq: String(row['active_fq'] ?? ''),
      budgetAuthority: toNumber(row['budget_authority_amount']),
      obligated: toNumber(row['obligated_amount']),
      outlay: toNumber(row['outlay_amount']),
      shareOfBudgetAuthority: toNumber(row['percentage_of_total_budget_authority']),
      slug: row['agency_slug'] == null ? null : String(row['agency_slug']),
    }))
    .filter((agency) => agency.name !== '')
    .sort((a, b) => b.budgetAuthority - a.budgetAuthority);
}

export async function fetchToptierAgencies(signal?: AbortSignal): Promise<Fetched<ToptierAgency[]>> {
  const descriptor = toptierAgenciesRequest();
  const result = await request<ToptierAgencyResponse>({
    upstream: 'usaspending',
    sourceId: descriptor.sourceId,
    path: descriptor.path,
    signal,
  });
  return { data: foldAgencies(result.data.results ?? []), provenance: result.provenance };
}

export interface AgencyYear {
  fiscalYear: number;
  budgetaryResources: number;
  obligated: number;
}

interface AgencyBudgetaryResourcesResponse {
  agency_data_by_year?: Row[];
}

export function foldAgencyYears(rows: Row[]): AgencyYear[] {
  return rows
    .map((row) => ({
      fiscalYear: toNumber(row['fiscal_year']),
      budgetaryResources: toNumber(row['agency_budgetary_resources'] ?? row['total_budgetary_resources']),
      obligated: toNumber(row['agency_total_obligated']),
    }))
    .filter((year) => Number.isFinite(year.fiscalYear))
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
}

export async function fetchAgencyBudgetaryResources(
  toptierCode: string,
  signal?: AbortSignal,
): Promise<Fetched<AgencyYear[]>> {
  const descriptor = agencyBudgetaryResourcesRequest(toptierCode);
  const result = await request<AgencyBudgetaryResourcesResponse>({
    upstream: 'usaspending',
    sourceId: descriptor.sourceId,
    path: descriptor.path,
    signal,
  });
  return { data: foldAgencyYears(result.data.agency_data_by_year ?? []), provenance: result.provenance };
}

/* ------------------------------------------------------------------ *
 * Spending Explorer — what the money is FOR
 * ------------------------------------------------------------------ */

export type ExplorerType =
  | 'budget_function'
  | 'budget_subfunction'
  | 'federal_account'
  | 'program_activity'
  | 'object_class'
  | 'agency';

export interface ExplorerNode {
  id: string | null;
  code: string | null;
  name: string;
  amount: number;
  /** Present on federal-account rows. */
  accountNumber?: string;
}

interface ExplorerResponse {
  total?: number;
  end_date?: string;
  results?: Row[];
}

export interface ExplorerResult {
  total: number;
  endDate: string | null;
  nodes: ExplorerNode[];
}

export function foldExplorer(response: ExplorerResponse): ExplorerResult {
  const nodes = (response.results ?? [])
    .map((row) => ({
      id: row['id'] == null ? null : String(row['id']),
      code: row['code'] == null ? null : String(row['code']),
      name: String(row['name'] ?? 'Unspecified'),
      amount: toNumber(row['amount']),
      ...(row['account_number'] == null ? {} : { accountNumber: String(row['account_number']) }),
    }))
    .filter((node) => Number.isFinite(node.amount))
    .sort((a, b) => b.amount - a.amount);

  return {
    total: toNumber(response.total ?? nodes.reduce((sum, node) => sum + node.amount, 0)),
    endDate: response.end_date == null ? null : String(response.end_date),
    nodes,
  };
}

export interface ExplorerQuery {
  type: ExplorerType;
  fiscalYear: number;
  /** 1–4. The explorer reports on completed quarters. */
  quarter?: number;
  /** Required when type is 'budget_subfunction': the parent function's code. */
  budgetFunction?: string;
  agency?: string;
}

export async function fetchSpendingExplorer(
  query: ExplorerQuery,
  signal?: AbortSignal,
): Promise<Fetched<ExplorerResult>> {
  const descriptor = spendingExplorerRequest(query);
  const result = await request<ExplorerResponse>({
    upstream: 'usaspending',
    sourceId: descriptor.sourceId,
    path: descriptor.path,
    method: 'POST',
    body: descriptor.body,
    signal,
  });
  return { data: foldExplorer(result.data), provenance: result.provenance };
}

/* ------------------------------------------------------------------ *
 * Award search — who received the money
 * ------------------------------------------------------------------ */

export type SpendingCategory =
  | 'awarding_agency'
  | 'awarding_subagency'
  | 'funding_agency'
  | 'recipient'
  | 'state_territory'
  | 'county'
  | 'district'
  | 'country'
  | 'federal_account'
  | 'cfda'
  | 'naics'
  | 'psc';

export interface CategoryRow {
  id: string | null;
  code: string | null;
  name: string;
  amount: number;
}

interface CategoryResponse {
  category?: string;
  results?: Row[];
}

export function foldCategoryRows(rows: Row[]): CategoryRow[] {
  return rows
    .map((row) => ({
      id: row['id'] == null ? null : String(row['id']),
      code: row['code'] == null ? null : String(row['code']),
      name: String(row['name'] ?? 'Unreported'),
      amount: toNumber(row['amount']),
    }))
    .filter((row) => Number.isFinite(row.amount))
    .sort((a, b) => b.amount - a.amount);
}

/** Contracts, grants, direct payments, loans, and other financial assistance. */
export const ALL_AWARD_TYPE_CODES = [
  'A',
  'B',
  'C',
  'D',
  'IDV_A',
  'IDV_B',
  'IDV_B_A',
  'IDV_B_B',
  'IDV_B_C',
  'IDV_C',
  'IDV_D',
  'IDV_E',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
] as const;

export interface AwardSearchFilters {
  startDate: string;
  endDate: string;
  awardTypeCodes?: readonly string[];
  agencyToptierName?: string;
}

export async function fetchSpendingByCategory(
  category: SpendingCategory,
  filters: AwardSearchFilters,
  limit = 15,
  signal?: AbortSignal,
): Promise<Fetched<CategoryRow[]>> {
  const descriptor = spendingByCategoryRequest(category, filters, limit);
  const result = await request<CategoryResponse>({
    upstream: 'usaspending',
    sourceId: descriptor.sourceId,
    path: descriptor.path,
    method: 'POST',
    body: descriptor.body,
    signal,
  });
  return { data: foldCategoryRows(result.data.results ?? []), provenance: result.provenance };
}

export interface TimePoint {
  /** Label for the period, e.g. 'FY2024' or 'FY2024 Q3'. */
  label: string;
  fiscalYear: number;
  quarter: number | null;
  amount: number;
}

interface OverTimeResponse {
  results?: Row[];
}

export function foldSpendingOverTime(rows: Row[]): TimePoint[] {
  return rows
    .map((row) => {
      const period = (row['time_period'] ?? {}) as Row;
      const fiscalYear = toNumber(period['fiscal_year']);
      const quarter = period['quarter'] == null ? null : toNumber(period['quarter']);
      return {
        fiscalYear,
        quarter,
        label: quarter == null ? `FY${fiscalYear}` : `FY${fiscalYear} Q${quarter}`,
        amount: toNumber(row['aggregated_amount']),
      };
    })
    .filter((point) => Number.isFinite(point.fiscalYear) && Number.isFinite(point.amount))
    .sort((a, b) => a.fiscalYear - b.fiscalYear || (a.quarter ?? 0) - (b.quarter ?? 0));
}

export async function fetchSpendingOverTime(
  group: 'fiscal_year' | 'quarter' | 'month',
  filters: AwardSearchFilters,
  signal?: AbortSignal,
): Promise<Fetched<TimePoint[]>> {
  const descriptor = spendingOverTimeRequest(group, filters);
  const result = await request<OverTimeResponse>({
    upstream: 'usaspending',
    sourceId: descriptor.sourceId,
    path: descriptor.path,
    method: 'POST',
    body: descriptor.body,
    signal,
  });
  return { data: foldSpendingOverTime(result.data.results ?? []), provenance: result.provenance };
}
