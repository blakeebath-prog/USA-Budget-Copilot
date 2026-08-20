/**
 * The endpoint contract this app depends on, and a runner for it.
 *
 * Shared by two scripts that ask the same question from different places:
 *
 *   verify-sources.mjs    — calls the government APIs directly
 *   check-deployment.mjs  — calls them through a deployed proxy
 *
 * Each check pairs a request with the field names the app will read from a row.
 * Keeping the candidate lists here, next to the request that produces them,
 * means a renamed upstream column is reported by name instead of quietly
 * rendering as a zero.
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
} from '../../shared/requests.mjs';

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
 * Run one check against whatever base a caller supplies.
 *
 * `resolveBase(upstream)` returns the origin+prefix the request path is
 * appended to — the government host when testing the APIs directly, or a
 * deployment's proxy route when testing a deployment.
 */
export async function runCheck(check, resolveBase, timeoutMs = 45_000) {
  const url = `${resolveBase(check.request.upstream)}${check.request.path}`;
  const started = Date.now();

  let response;
  try {
    response = await fetch(url, {
      method: check.request.method,
      headers: {
        Accept: 'application/json',
        ...(check.request.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(check.request.body ? { body: JSON.stringify(check.request.body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, url, reason: `request failed: ${error.message}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, url, status: response.status, reason: `HTTP ${response.status} — ${text.slice(0, 300)}` };
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      url,
      status: response.status,
      reason: `response was not JSON. First 200 characters: ${text.slice(0, 200)}`,
    };
  }

  const rows = check.rowsAt(json);
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ok: false,
      url,
      status: response.status,
      reason: 'no rows returned — the endpoint answered but has no data for this period',
    };
  }

  const sample = rows[0];
  const resolved = {};
  const missing = [];
  for (const [purpose, candidates] of Object.entries(check.expect)) {
    const found = candidates.find((candidate) => sample[candidate] !== undefined);
    if (found) resolved[purpose] = found;
    else missing.push({ purpose, candidates });
  }

  return {
    ok: missing.length === 0,
    url,
    status: response.status,
    ms: Date.now() - started,
    rowCount: rows.length,
    fields: Object.keys(sample),
    resolved,
    missing,
  };
}

const ESC = String.fromCharCode(27);
const useColor = process.stdout.isTTY && !process.env['NO_COLOR'];
const paint = (code, text) => (useColor ? `${ESC}[${code}m${text}${ESC}[0m` : text);

export const green = (text) => paint('32', text);
export const red = (text) => paint('31', text);
export const yellow = (text) => paint('33', text);
export const dim = (text) => paint('2', text);

/** Print one result in the shape both scripts report. */
export function printResult(check, result) {
  if (result.ok) {
    console.log(`${green('PASS')} ${check.name} ${dim(`(${result.rowCount} rows, ${result.ms}ms)`)}`);
    const width = Math.max(...Object.keys(result.resolved).map((key) => key.length));
    for (const [purpose, field] of Object.entries(result.resolved)) {
      console.log(dim(`       ${purpose.padEnd(width)} → ${field}`));
    }
    return;
  }

  console.log(`${red('FAIL')} ${check.name}`);
  console.log(dim(`       ${result.url}`));
  if (result.reason) console.log(`       ${result.reason}`);
  for (const entry of result.missing ?? []) {
    console.log(`       ${yellow(`no field for "${entry.purpose}"`)} — tried [${entry.candidates.join(', ')}]`);
  }
  if (result.fields) console.log(dim(`       fields actually returned: ${result.fields.join(', ')}`));
}
