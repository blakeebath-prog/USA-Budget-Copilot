#!/usr/bin/env node
/**
 * Diagnose a deployed instance from the outside.
 *
 *   npm run check:deployment https://your-app.vercel.app
 *
 * Answers, in one pass, the questions that decide whether a deployment works:
 *
 *   1. Is the site up and serving the built bundle?
 *   2. Which data mode was it built with?
 *   3. Are the proxy functions deployed and reaching the government APIs?
 *   4. Do the live APIs still return the fields the app reads?
 *
 * Point 4 is the valuable one. Running the checks *through* the deployment
 * exercises the same path a visitor's browser takes, so a pass here means the
 * deployment genuinely works rather than that the APIs happen to be up.
 */
import process from 'node:process';
import { buildChecks, dim, green, printResult, red, runCheck, yellow } from './lib/endpoint-checks.mjs';

const target = process.argv[2];
if (!target) {
  console.error('Usage: npm run check:deployment <url>');
  console.error('   e.g. npm run check:deployment https://usa-budget-copilot.vercel.app');
  process.exit(2);
}

const origin = target.replace(/\/+$/, '');

async function fetchText(url, init = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), ...init });
  return { response, text: await response.text() };
}

/** Is the site serving the built app at all? */
async function checkStaticSite() {
  console.log('1. Static site');
  try {
    const { response, text } = await fetchText(`${origin}/`);
    if (!response.ok) {
      console.log(`   ${red(`FAIL`)} GET / returned HTTP ${response.status}`);
      return null;
    }

    const scriptMatch = text.match(/<script[^>]+src="([^"]+)"/);
    const hasRoot = text.includes('id="root"');
    console.log(`   ${green('PASS')} HTTP 200, ${text.length} bytes, #root ${hasRoot ? 'present' : dim('MISSING')}`);
    if (!scriptMatch) {
      console.log(`   ${yellow('WARN')} no module script tag found — is this the built output?`);
      return null;
    }
    console.log(dim(`        bundle: ${scriptMatch[1]}`));
    return new URL(scriptMatch[1], `${origin}/`).toString();
  } catch (error) {
    console.log(`   ${red('FAIL')} could not reach ${origin} — ${error.message}`);
    return null;
  }
}

/**
 * Which data mode the deployed bundle was built with.
 *
 * Read off the bundle rather than guessed: the proxy prefixes only appear in a
 * build that can actually use them, and a snapshot build fetches from /data.
 */
async function detectDataMode(bundleUrl) {
  console.log('\n2. Data mode of the deployed bundle');
  if (!bundleUrl) {
    console.log(`   ${yellow('SKIP')} no bundle URL to inspect`);
    return 'unknown';
  }
  try {
    const { response, text } = await fetchText(bundleUrl);
    if (!response.ok) {
      console.log(`   ${red('FAIL')} bundle returned HTTP ${response.status}`);
      return 'unknown';
    }

    // The mode is a build-time constant, so exactly one of these branches
    // survives minification.
    const usesProxy = text.includes('/api/usaspending');
    const usesSnapshot = /["'`]\/data\//.test(text);
    const mode = usesSnapshot ? 'snapshot' : usesProxy ? 'proxy' : 'direct';

    console.log(`   ${green('INFO')} looks like ${green(mode)} mode`);
    if (mode === 'direct') {
      console.log(dim('        the browser calls the .gov APIs itself; CORS must allow it'));
    } else if (mode === 'proxy') {
      console.log(dim('        requests route through this deployment’s own /api/* functions'));
    } else {
      console.log(dim('        the app reads pinned snapshots and makes no live API calls'));
    }
    return mode;
  } catch (error) {
    console.log(`   ${red('FAIL')} could not fetch the bundle — ${error.message}`);
    return 'unknown';
  }
}

/** Are the serverless proxies deployed and able to reach upstream? */
async function checkProxyRoutes() {
  console.log('\n3. Proxy functions');
  const probes = [
    {
      label: 'fiscaldata',
      url: `${origin}/api/fiscaldata/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1&format=json`,
    },
    {
      label: 'usaspending',
      url: `${origin}/api/usaspending/api/v2/references/toptier_agencies/`,
    },
  ];

  let working = 0;
  for (const probe of probes) {
    try {
      const { response, text } = await fetchText(probe.url);
      const looksJson = text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
      if (response.ok && looksJson) {
        working += 1;
        console.log(`   ${green('PASS')} /api/${probe.label} → HTTP ${response.status}, JSON (${text.length} bytes)`);
      } else if (response.status === 404) {
        console.log(
          `   ${yellow('N/A ')} /api/${probe.label} → HTTP 404 — functions are not deployed on this host`,
        );
      } else {
        console.log(`   ${red('FAIL')} /api/${probe.label} → HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
    } catch (error) {
      console.log(`   ${red('FAIL')} /api/${probe.label} — ${error.message}`);
    }
  }
  return working === probes.length;
}

/** Run the full endpoint contract through whichever path the deployment offers. */
async function checkEndpoints(viaProxy) {
  console.log(`\n4. Endpoint contract ${viaProxy ? 'through the deployment’s proxy' : 'against the .gov APIs directly'}`);
  console.log(
    dim(
      viaProxy
        ? '   This is the same path a visitor’s browser takes in proxy mode.\n'
        : '   The proxy is unavailable, so these call the government APIs from this machine.\n',
    ),
  );

  const resolveBase = viaProxy
    ? (upstream) => `${origin}/api/${upstream}`
    : (upstream) =>
        upstream === 'usaspending' ? 'https://api.usaspending.gov' : 'https://api.fiscaldata.treasury.gov';

  const checks = buildChecks();
  let failures = 0;
  for (const check of checks) {
    const result = await runCheck(check, resolveBase);
    if (!result.ok) failures += 1;
    printResult(check, result);
    console.log('');
  }
  return { failures, total: checks.length };
}

async function main() {
  console.log(`Checking deployment: ${origin}\n`);

  const bundleUrl = await checkStaticSite();
  const mode = await detectDataMode(bundleUrl);
  const proxyWorks = await checkProxyRoutes();
  const { failures, total } = await checkEndpoints(proxyWorks);

  console.log('─'.repeat(72));
  console.log('Summary');
  console.log(`  site       ${bundleUrl ? green('reachable') : red('unreachable')}`);
  console.log(`  data mode  ${mode}`);
  console.log(`  proxy      ${proxyWorks ? green('working') : yellow('not serving')}`);
  console.log(`  endpoints  ${failures === 0 ? green(`${total}/${total} pass`) : red(`${failures}/${total} failing`)}`);

  if (mode === 'direct') {
    console.log(
      `\n${yellow('Note')} In direct mode the browser calls the .gov APIs itself, which this script\n` +
        '     cannot test for you — CORS applies to browsers, not to Node. Open the\n' +
        '     deployment and check the browser console: a message naming "CORS policy"\n' +
        '     means you want VITE_DATA_MODE=proxy set in Vercel, then a redeploy.',
    );
  }

  if (failures > 0) process.exitCode = 1;
}

main();
