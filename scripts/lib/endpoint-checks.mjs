/**
 * Node-side runner and console reporting for the endpoint contract.
 *
 * The contract itself lives in shared/endpointContract.mjs so the browser
 * self-check can run the identical set of checks; this file only knows how to
 * execute them from Node and print the result.
 */
import process from 'node:process';
import { buildChecks, currentFiscalYear, GOV_HOSTS, resolveFields } from '../../shared/endpointContract.mjs';

export { buildChecks, currentFiscalYear, GOV_HOSTS };

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
  const { resolved, missing } = resolveFields(sample, check.expect);

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
