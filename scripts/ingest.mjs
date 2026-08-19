#!/usr/bin/env node
/**
 * Fetch every request the app makes and write the responses to public/data/.
 *
 * With snapshots in place, `VITE_DATA_MODE=snapshot` runs the whole tool with
 * no network at all. That covers three real situations: a machine whose egress
 * policy blocks .gov hosts, a demo that must not depend on an API being up, and
 * a build pipeline that wants the data pinned to a known date.
 *
 * Files are named by the same request key the browser computes, so a snapshot
 * is found by exactly the request it was captured for — see shared/cacheKey.mjs.
 *
 *   npm run ingest                 # default fiscal years
 *   npm run ingest -- --fy 2024    # a specific year
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { cacheKey } from '../shared/cacheKey.mjs';
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

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

/** Matches the app's own history window. Keep the two in step or snapshots miss. */
const HISTORY_START = '2015-10-01';
const DEBT_START = '2010-01-01';

function parseArgs(argv) {
  const args = { fiscalYears: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--fy' && argv[index + 1]) {
      args.fiscalYears.push(Number(argv[index + 1]));
      index += 1;
    }
  }
  return args;
}

function currentFiscalYear() {
  const now = new Date();
  return now.getUTCMonth() + 1 >= 10 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

function buildRequestList(fiscalYears) {
  const requests = [
    monthlyFlowsRequest(HISTORY_START),
    debtRequest(DEBT_START),
    toptierAgenciesRequest(),
  ];

  for (const fiscalYear of fiscalYears) {
    requests.push(receiptsBySourceRequest(fiscalYear));
    requests.push(outlaysByDepartmentRequest(fiscalYear));
    requests.push(spendingExplorerRequest({ type: 'budget_function', fiscalYear, quarter: 4 }));
    requests.push(
      spendingByCategoryRequest('recipient', {
        startDate: `${fiscalYear - 1}-10-01`,
        endDate: `${fiscalYear}-09-30`,
      }),
    );
    requests.push(
      spendingByCategoryRequest('awarding_agency', {
        startDate: `${fiscalYear - 1}-10-01`,
        endDate: `${fiscalYear}-09-30`,
      }),
    );
    requests.push(
      spendingByCategoryRequest('state_territory', {
        startDate: `${fiscalYear - 1}-10-01`,
        endDate: `${fiscalYear}-09-30`,
      }),
    );
  }

  const newest = Math.max(...fiscalYears);
  const oldest = Math.min(...fiscalYears);
  requests.push(
    spendingOverTimeRequest('fiscal_year', {
      startDate: `${oldest - 1}-10-01`,
      endDate: `${newest}-09-30`,
    }),
  );

  return requests;
}

async function fetchOne(descriptor) {
  const url = `${HOSTS[descriptor.upstream]}${descriptor.path}`;
  const response = await fetch(url, {
    method: descriptor.method,
    headers: {
      Accept: 'application/json',
      ...(descriptor.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(descriptor.body ? { body: JSON.stringify(descriptor.body) } : {}),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} for ${url} — ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fiscalYears = args.fiscalYears.length
    ? args.fiscalYears
    : [currentFiscalYear() - 2, currentFiscalYear() - 1, currentFiscalYear()];

  const requests = buildRequestList(fiscalYears);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Fetching ${requests.length} requests for fiscal years ${fiscalYears.join(', ')}.\n`);

  const manifest = [];
  let failures = 0;

  for (const descriptor of requests) {
    const key = cacheKey(descriptor.upstream, descriptor.method, descriptor.path, descriptor.body);
    const target = path.join(OUT_DIR, `${key}.json`);
    try {
      const payload = await fetchOne(descriptor);
      await writeFile(target, JSON.stringify(payload), 'utf8');
      manifest.push({
        key,
        upstream: descriptor.upstream,
        sourceId: descriptor.sourceId,
        method: descriptor.method,
        url: `${HOSTS[descriptor.upstream]}${descriptor.path}`,
        body: descriptor.body ?? null,
        retrievedAt: new Date().toISOString(),
      });
      console.log(`  saved ${key}.json  ${descriptor.method} ${descriptor.path.slice(0, 90)}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAILED ${descriptor.method} ${descriptor.path}\n         ${error.message}`);
    }
  }

  await writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), fiscalYears, entries: manifest }, null, 2),
    'utf8',
  );

  console.log(`\nWrote ${manifest.length} snapshots to public/data/.`);
  if (failures > 0) {
    console.error(`${failures} request(s) failed; snapshot mode will show an error for those panels.`);
    process.exitCode = 1;
  } else {
    console.log('Run the app with VITE_DATA_MODE=snapshot to read these instead of the live APIs.');
  }
}

main();
