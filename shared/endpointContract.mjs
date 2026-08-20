/**
 * The endpoint contract this app depends on.
 *
 * Every request the app makes, paired with the field names it will read from
 * each response row. Three very different consumers share this one definition:
 *
 *   scripts/verify-sources.mjs    — Node, calling the government APIs directly
 *   scripts/check-deployment.mjs  — Node, calling them through a deployment
 *   src/views/SelfCheckView.tsx   — the browser, from inside the deployed app
 *
 * It therefore contains no Node APIs and no DOM APIs — only the contract. The
 * runners live with their callers.
 */

import {
  monthlyFlowsRequest,
  receiptsBySourceRequest,
  outlaysByDepartmentRequest,
  debtRequest,
  toptierAgenciesRequest,
  spendingExplorerRequest,
  spendingByCategoryRequest,
  spendingOverTimeRequest,
} from './requests.mjs';

export const GOV_HOSTS = {
  usaspending: 'https://api.usaspending.gov',
  fiscaldata: 'https://api.fiscaldata.treasury.gov',
};

export function currentFiscalYear(now = new Date()) {
  return now.getUTCMonth() + 1 >= 10 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

export function buildChecks(lastCompleteFy = currentFiscalYear() - 1) {
  return [
    {
      name: 'MTS Table 1 — receipts, outlays, deficit',
      request: monthlyFlowsRequest(`${lastCompleteFy - 1}-10-01`),
      rowsAt: (json) => json.data,
      expect: {
        'record date': ['record_date'],
        'classification label': ['classification_desc'],
        'monthly receipts': ['current_month_gross_rcpt_amt', 'current_month_rcpt_amt', 'current_month_budget_amt'],
        'monthly outlays': ['current_month_gross_outly_amt', 'current_month_outly_amt', 'current_month_budget_amt'],
        'monthly deficit': ['current_month_dfct_sur_amt', 'current_month_budget_amt'],
      },
    },
    {
      name: 'MTS Table 4 — receipts by source',
      request: receiptsBySourceRequest(lastCompleteFy),
      rowsAt: (json) => json.data,
      expect: {
        'record date': ['record_date'],
        'classification label': ['classification_desc'],
        'fiscal-year-to-date amount': [
          'current_fytd_net_rcpt_amt',
          'current_fytd_rcpt_amt',
          'current_fytd_gross_rcpt_amt',
          'current_fytd_budget_amt',
          'current_fytd_amt',
        ],
      },
    },
    {
      name: 'MTS Table 5 — outlays by department',
      request: outlaysByDepartmentRequest(lastCompleteFy),
      rowsAt: (json) => json.data,
      expect: {
        'record date': ['record_date'],
        'classification label': ['classification_desc'],
        'fiscal-year-to-date amount': [
          'current_fytd_net_outly_amt',
          'current_fytd_outly_amt',
          'current_fytd_gross_outly_amt',
          'current_fytd_budget_amt',
          'current_fytd_amt',
        ],
      },
    },
    {
      name: 'Debt to the Penny',
      request: debtRequest(`${lastCompleteFy}-01-01`),
      rowsAt: (json) => json.data,
      expect: {
        'record date': ['record_date'],
        'held by the public': ['debt_held_public_amt'],
        intragovernmental: ['intragov_hold_amt'],
        total: ['tot_pub_debt_out_amt'],
      },
    },
    {
      name: 'USAspending — toptier agencies',
      request: toptierAgenciesRequest(),
      rowsAt: (json) => json.results,
      expect: {
        name: ['agency_name'],
        code: ['toptier_code'],
        'budgetary resources': ['budget_authority_amount'],
        obligations: ['obligated_amount'],
        outlays: ['outlay_amount'],
      },
    },
    {
      name: 'USAspending — spending explorer, budget function',
      request: spendingExplorerRequest({ type: 'budget_function', fiscalYear: lastCompleteFy, quarter: 4 }),
      rowsAt: (json) => json.results,
      expect: { name: ['name'], amount: ['amount'], code: ['code', 'id'] },
    },
    {
      name: 'USAspending — spending by recipient',
      request: spendingByCategoryRequest('recipient', {
        startDate: `${lastCompleteFy - 1}-10-01`,
        endDate: `${lastCompleteFy}-09-30`,
      }),
      rowsAt: (json) => json.results,
      expect: { name: ['name'], amount: ['amount'] },
    },
    {
      name: 'USAspending — spending over time',
      request: spendingOverTimeRequest('fiscal_year', {
        startDate: `${lastCompleteFy - 2}-10-01`,
        endDate: `${lastCompleteFy}-09-30`,
      }),
      rowsAt: (json) => json.results,
      expect: { period: ['time_period'], amount: ['aggregated_amount'] },
    },
  ];
}

/**
 * Which candidate field name each value actually resolved to in a sample row.
 *
 * The whole point of the tolerant reader in src/lib/api/fieldResolution.ts is
 * that a value can arrive under one of several names. This reports which one
 * won, and which values found no name at all — the latter being the case that
 * would otherwise render as a silent zero.
 */
export function resolveFields(sample, expect) {
  const resolved = {};
  const missing = [];
  for (const [purpose, candidates] of Object.entries(expect)) {
    const found = candidates.find((candidate) => sample[candidate] !== undefined);
    if (found) resolved[purpose] = found;
    else missing.push({ purpose, candidates });
  }
  return { resolved, missing };
}
