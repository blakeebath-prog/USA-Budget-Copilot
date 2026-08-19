#!/usr/bin/env node
/**
 * Hit every endpoint this app depends on and report what actually came back.
 *
 * Run this on a machine with network access to the .gov APIs. It is the answer
 * to "did a feed rename a column?" — it prints the columns each endpoint
 * returns today and checks them against the candidate names the app reads, so a
 * schema drift is a one-command diagnosis instead of a chart full of zeros.
 *
 *   npm run verify:sources
 */
import process from 'node:process';
import {
  monthlyFlowsRequest,
  receiptsBySourceRequest,
  outlaysByDepartmentRequest,
  debtRequest,
  toptierAgenciesRequest,
  spendingExplorerRequest,
  spendingByCategoryRequest,
  spendingOverTimeRequest,
} from '../shared/requests.mjs';

const HOSTS = {
  usaspending: process.env.VITE_USASPENDING_BASE ?? 'https://api.usaspending.gov',
  fiscaldata: process.env.VITE_FISCALDATA_BASE ?? 'https://api.fiscaldata.treasury.gov',
};

const currentFiscalYear = (() => {
  const now = new Date();
  return now.getUTCMonth() + 1 >= 10 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
})();
const lastCompleteFy = currentFiscalYear - 1;

/**
 * Each check names the request, where the rows live in the response, and the
 * field names the app will try to read from a row — the same candidate lists
 * src/lib/api/ uses, kept here so a mismatch is reported rather than rendered.
 */
const CHECKS = [
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

const COLOR = process.stdout.isTTY && !process.env['NO_COLOR'];
const paint = (code, text) => (COLOR ? `[${code}m${text}[0m` : text);
const green = (text) => paint('32', text);
const red = (text) => paint('31', text);
const yellow = (text) => paint('33', text);
const dim = (text) => paint('2', text);

async function runCheck(check) {
  const url = `${HOSTS[check.request.upstream]}${check.request.path}`;
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
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    return { ok: false, url, reason: `request failed: ${error.message}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, url, reason: `HTTP ${response.status} — ${text.slice(0, 200)}` };
  }

  const json = await response.json().catch(() => null);
  if (!json) return { ok: false, url, reason: 'response was not JSON' };

  const rows = check.rowsAt(json);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, url, reason: 'no rows returned — the endpoint answered but has no data for this period' };
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
    ms: Date.now() - started,
    rowCount: rows.length,
    fields: Object.keys(sample),
    resolved,
    missing,
  };
}

async function main() {
  console.log(`Verifying ${CHECKS.length} endpoints against the live government APIs.\n`);
  let failures = 0;

  for (const check of CHECKS) {
    const result = await runCheck(check);

    if (result.ok) {
      console.log(`${green('PASS')} ${check.name} ${dim(`(${result.rowCount} rows, ${result.ms}ms)`)}`);
      const width = Math.max(...Object.keys(result.resolved).map((key) => key.length));
      for (const [purpose, field] of Object.entries(result.resolved)) {
        console.log(dim(`       ${purpose.padEnd(width)} → ${field}`));
      }
    } else {
      failures += 1;
      console.log(`${red('FAIL')} ${check.name}`);
      console.log(dim(`       ${result.url}`));
      if (result.reason) console.log(`       ${result.reason}`);
      for (const entry of result.missing ?? []) {
        console.log(`       ${yellow(`no field for "${entry.purpose}"`)} — tried [${entry.candidates.join(', ')}]`);
      }
      if (result.fields) console.log(dim(`       fields actually returned: ${result.fields.join(', ')}`));
    }
    console.log('');
  }

  if (failures > 0) {
    console.log(
      `${red(`${failures} of ${CHECKS.length} checks failed.`)} Add any field names printed above to the candidate lists in src/lib/api/.`,
    );
    process.exitCode = 1;
  } else {
    console.log(green(`All ${CHECKS.length} endpoints match what the app expects.`));
  }
}

main();
