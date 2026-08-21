/**
 * Request builders for both government APIs.
 *
 * These live in plain JS, outside src/, because two very different consumers
 * need to produce byte-identical requests: the browser data layer, and the Node
 * snapshot writer in scripts/ingest.mjs. If the two built their own URLs, a
 * snapshot would quietly stop matching the request it was meant to satisfy.
 */

export const FISCAL_SERVICE_ROOT = '/services/api/fiscal_service';

/** @typedef {{endpoint: string, filters?: string[], sort?: string[], pageSize?: number, pageNumber?: number}} FiscalDataQuery */

/** @param {FiscalDataQuery} query */
export function fiscalDataPath(query) {
  // Built by hand rather than with URLSearchParams: the Fiscal Data API's
  // pagination parameters are literally named `page[size]` and `page[number]`,
  // and percent-encoding those brackets is not what its examples show.
  const parts = [];
  if (query.filters && query.filters.length) parts.push(`filter=${encodeURIComponent(query.filters.join(','))}`);
  if (query.sort && query.sort.length) parts.push(`sort=${encodeURIComponent(query.sort.join(','))}`);
  parts.push(`page[size]=${query.pageSize ?? 1000}`);
  parts.push(`page[number]=${query.pageNumber ?? 1}`);
  parts.push('format=json');
  return `${FISCAL_SERVICE_ROOT}${query.endpoint}?${parts.join('&')}`;
}

export const MTS_TABLE_1 = '/v1/accounting/mts/mts_table_1';
export const MTS_TABLE_4 = '/v1/accounting/mts/mts_table_4';
export const MTS_TABLE_5 = '/v1/accounting/mts/mts_table_5';
export const DEBT_TO_PENNY = '/v2/accounting/od/debt_to_penny';

export function monthlyFlowsRequest(startDate) {
  return {
    upstream: 'fiscaldata',
    sourceId: 'mts-summary',
    method: 'GET',
    path: fiscalDataPath({
      endpoint: MTS_TABLE_1,
      filters: [`record_date:gte:${startDate}`],
      sort: ['record_date'],
      // Roughly 22 period rows per monthly statement, and the Overview asks for
      // a decade, so the page has to hold a few thousand.
      pageSize: 10000,
    }),
  };
}

export function receiptsBySourceRequest(fiscalYear) {
  return {
    upstream: 'fiscaldata',
    sourceId: 'mts-receipts',
    method: 'GET',
    path: fiscalDataPath({
      endpoint: MTS_TABLE_4,
      filters: [`record_fiscal_year:eq:${fiscalYear}`],
      sort: ['-record_date'],
      pageSize: 5000,
    }),
  };
}

export function outlaysByDepartmentRequest(fiscalYear) {
  return {
    upstream: 'fiscaldata',
    sourceId: 'mts-outlays',
    method: 'GET',
    path: fiscalDataPath({
      endpoint: MTS_TABLE_5,
      filters: [`record_fiscal_year:eq:${fiscalYear}`],
      // Table 5 carries ~580 lines per month, so a full fiscal year overruns
      // any page size worth requesting — a 5000-row page came back exactly
      // full, meaning truncated. Only the newest month is ever charted and the
      // sort puts it first, so two months' worth is ample and far quicker.
      sort: ['-record_date'],
      pageSize: 1500,
    }),
  };
}

export function debtRequest(startDate) {
  return {
    upstream: 'fiscaldata',
    sourceId: 'debt-to-penny',
    method: 'GET',
    path: fiscalDataPath({
      endpoint: DEBT_TO_PENNY,
      filters: [`record_date:gte:${startDate}`],
      sort: ['record_date'],
      pageSize: 10000,
    }),
  };
}

export function toptierAgenciesRequest() {
  return {
    upstream: 'usaspending',
    sourceId: 'usaspending-agencies',
    method: 'GET',
    path: '/api/v2/references/toptier_agencies/?sort=budget_authority_amount&order=desc',
  };
}

export function agencyBudgetaryResourcesRequest(toptierCode) {
  return {
    upstream: 'usaspending',
    sourceId: 'usaspending-agencies',
    method: 'GET',
    path: `/api/v2/agency/${encodeURIComponent(toptierCode)}/budgetary_resources/`,
  };
}

export function spendingExplorerRequest({ type, fiscalYear, quarter, budgetFunction, agency }) {
  const filters = { fy: String(fiscalYear) };
  if (quarter) filters.quarter = String(quarter);
  if (budgetFunction) filters.budget_function = budgetFunction;
  if (agency) filters.agency = agency;
  return {
    upstream: 'usaspending',
    sourceId: 'usaspending-budget-function',
    method: 'POST',
    path: '/api/v2/spending/',
    body: { type, filters },
  };
}

export function searchFilters({ startDate, endDate, awardTypeCodes, agencyToptierName }) {
  const built = { time_period: [{ start_date: startDate, end_date: endDate }] };
  if (awardTypeCodes && awardTypeCodes.length) built.award_type_codes = [...awardTypeCodes];
  if (agencyToptierName) {
    built.agencies = [{ type: 'awarding', tier: 'toptier', name: agencyToptierName }];
  }
  return built;
}

export function spendingByCategoryRequest(category, filters, limit = 15) {
  return {
    upstream: 'usaspending',
    sourceId: 'usaspending-awards',
    method: 'POST',
    path: `/api/v2/search/spending_by_category/${category}/`,
    body: { filters: searchFilters(filters), limit, page: 1 },
  };
}

export function spendingOverTimeRequest(group, filters) {
  return {
    upstream: 'usaspending',
    sourceId: 'usaspending-awards',
    method: 'POST',
    path: '/api/v2/search/spending_over_time/',
    body: { group, filters: searchFilters(filters) },
  };
}
