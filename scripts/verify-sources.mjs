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
 *
 * To check a deployment rather than the APIs themselves, use
 * `npm run check:deployment <url>`, which runs these same checks through the
 * deployed proxy routes.
 */
import process from 'node:process';
import { buildChecks, green, printResult, red, runCheck } from './lib/endpoint-checks.mjs';

const HOSTS = {
  usaspending: process.env.VITE_USASPENDING_BASE ?? 'https://api.usaspending.gov',
  fiscaldata: process.env.VITE_FISCALDATA_BASE ?? 'https://api.fiscaldata.treasury.gov',
};

async function main() {
  const checks = buildChecks();
  console.log(`Verifying ${checks.length} endpoints against the live government APIs.\n`);

  let failures = 0;
  for (const check of checks) {
    const result = await runCheck(check, (upstream) => HOSTS[upstream]);
    if (!result.ok) failures += 1;
    printResult(check, result);
    console.log('');
  }

  if (failures > 0) {
    console.log(
      `${red(`${failures} of ${checks.length} checks failed.`)} Add any field names printed above to the candidate lists in src/lib/api/.`,
    );
    process.exitCode = 1;
  } else {
    console.log(green(`All ${checks.length} endpoints match what the app expects.`));
  }
}

main();
