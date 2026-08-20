import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { buildChecks, resolveFields, type EndpointCheck } from '../../shared/endpointContract.mjs';
import { citationUrl, getDataMode, resolveUrl } from '../lib/http';

/**
 * Self-diagnosis, run from inside the deployed app.
 *
 * The Node scripts can check the same endpoints, but they need a terminal and
 * they cannot test the one thing most likely to break a browser deployment:
 * CORS is a browser rule, so a request Node completes happily may be refused in
 * a page. This runs the identical contract from the real page, over the real
 * data mode, and hands back a report that can be pasted into an issue.
 *
 * Reached at `?selfcheck=1` rather than from the nav — it is a diagnostic, not
 * something a reader looking at budget figures should trip over.
 */

type Status = 'pending' | 'running' | 'pass' | 'fail';

interface CheckResult {
  name: string;
  status: Status;
  url: string;
  /** Present when the request completed, whatever it returned. */
  httpStatus?: number;
  ms?: number;
  rowCount?: number;
  fields?: string[];
  resolved?: Record<string, string>;
  missing?: { purpose: string; candidates: string[] }[];
  reason?: string;
  /** True when the failure looks like the browser refusing a cross-origin call. */
  corsSuspected?: boolean;
}

const REQUEST_TIMEOUT_MS = 45_000;

async function runCheck(check: EndpointCheck): Promise<CheckResult> {
  const mode = getDataMode();
  const url = mode === 'snapshot' ? '(snapshot mode makes no live request)' : resolveUrl(check.request.upstream, check.request.path);
  const displayUrl = citationUrl(check.request.upstream, check.request.path);
  const started = performance.now();

  if (mode === 'snapshot') {
    return {
      name: check.name,
      status: 'fail',
      url,
      reason: 'This build reads pinned snapshots, so there is no live endpoint to check.',
    };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: check.request.method,
      headers: {
        Accept: 'application/json',
        ...(check.request.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(check.request.body ? { body: JSON.stringify(check.request.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A fetch that rejects without ever producing a status was stopped before
    // it got an answer. The browser deliberately does not say why — a CORS
    // refusal and a blocked network are indistinguishable from script, by
    // design. CORS is the likeliest cause on a public deployment in direct
    // mode, so that is what this suggests, but it is a guess and says so.
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: check.name,
      status: 'fail',
      url,
      reason: `The browser could not complete this request: ${message}`,
      corsSuspected: getDataMode() === 'direct',
    };
  }

  const ms = Math.round(performance.now() - started);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      name: check.name,
      status: 'fail',
      url,
      httpStatus: response.status,
      ms,
      reason: `HTTP ${response.status} — ${text.slice(0, 300) || '(empty body)'}`,
    };
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      name: check.name,
      status: 'fail',
      url,
      httpStatus: response.status,
      ms,
      reason: `Response was not JSON. First 200 characters: ${text.slice(0, 200)}`,
    };
  }

  const rows = check.rowsAt(json);
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      name: check.name,
      status: 'fail',
      url,
      httpStatus: response.status,
      ms,
      reason: 'The endpoint answered but returned no rows for this period.',
    };
  }

  const sample = rows[0] as Record<string, unknown>;
  const { resolved, missing } = resolveFields(sample, check.expect);

  return {
    name: check.name,
    status: missing.length === 0 ? 'pass' : 'fail',
    url: displayUrl,
    httpStatus: response.status,
    ms,
    rowCount: rows.length,
    fields: Object.keys(sample),
    resolved,
    missing,
  };
}

function buildReport(results: CheckResult[], mode: string): string {
  const lines: string[] = [
    'USA Budget Copilot — self check',
    `when:      ${new Date().toISOString()}`,
    `origin:    ${window.location.origin}`,
    `data mode: ${mode}`,
    `result:    ${results.filter((r) => r.status === 'pass').length}/${results.length} passing`,
    '',
  ];

  for (const result of results) {
    lines.push(`${result.status === 'pass' ? 'PASS' : 'FAIL'}  ${result.name}`);
    lines.push(`      ${result.url}`);
    if (result.httpStatus !== undefined) {
      lines.push(`      HTTP ${result.httpStatus}, ${result.rowCount ?? 0} rows, ${result.ms}ms`);
    }
    if (result.reason) lines.push(`      ${result.reason}`);
    if (result.corsSuspected) {
      lines.push('      no HTTP status at all — CORS refusal or blocked network (indistinguishable)');
    }
    for (const [purpose, field] of Object.entries(result.resolved ?? {})) {
      lines.push(`      ${purpose} -> ${field}`);
    }
    for (const entry of result.missing ?? []) {
      lines.push(`      MISSING ${entry.purpose} — tried [${entry.candidates.join(', ')}]`);
    }
    if (result.missing?.length && result.fields) {
      lines.push(`      fields returned: ${result.fields.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function SelfCheckView(): ReactNode {
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const mode = getDataMode();

  const run = useCallback(async () => {
    const checks = buildChecks();
    setRunning(true);
    setCopied(false);
    setResults(checks.map((check) => ({ name: check.name, status: 'pending' as const, url: '' })));

    // Sequential on purpose: a burst of parallel requests to the same API can
    // trip rate limiting, and a rate-limit error here would read as a broken
    // deployment rather than as this page's own fault.
    for (const [index, check] of checks.entries()) {
      setResults((previous) =>
        previous.map((entry, position) => (position === index ? { ...entry, status: 'running' } : entry)),
      );
      const result = await runCheck(check);
      setResults((previous) => previous.map((entry, position) => (position === index ? result : entry)));
    }

    setRunning(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const completed = results.filter((result) => result.status === 'pass' || result.status === 'fail');
  const passing = results.filter((result) => result.status === 'pass').length;
  const corsSuspected = results.some((result) => result.corsSuspected);
  const report = buildReport(completed, mode);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <p className="view__intro">
        Runs every request this app depends on, from this page, over the live connection — then reports which
        fields each feed actually returned. This is the browser's own view of whether the deployment works.
      </p>

      <div className="banner">
        Data mode: <code>{mode}</code> · origin <code>{window.location.origin}</code> ·{' '}
        {running
          ? `checking ${completed.length + 1} of ${results.length}…`
          : `${passing} of ${completed.length} checks passing`}
      </div>

      {corsSuspected && !running ? (
        <div className="errorstate" role="alert">
          <p className="errorstate__headline">Requests are being stopped before they get an answer.</p>
          <p className="errorstate__hint">
            Every request failed without receiving any HTTP status. That means something refused it up front —
            most often CORS, since this build calls the government APIs cross-origin, but a blocked or offline
            network looks identical from here. The browser does not reveal which, by design, so this cannot tell
            you for certain.
          </p>
          <p className="errorstate__hint">
            If this is a public deployment, CORS is the likely cause and the fix is one setting: in the Vercel
            dashboard open <strong>Settings → Environment Variables</strong>, add <code>VITE_DATA_MODE</code> with
            the value <code>proxy</code> for Production, then <strong>Deployments → ⋯ → Redeploy</strong>.
            Requests will route through this deployment's own <code>/api/*</code> functions instead, where CORS
            does not apply. Re-run this page afterwards to confirm.
          </p>
        </div>
      ) : null}

      <div className="filters">
        <button type="button" className="button" onClick={() => void run()} disabled={running}>
          {running ? 'Running…' : 'Run again'}
        </button>
        <button type="button" className="button" onClick={() => void copy()} disabled={running || !completed.length}>
          {copied ? 'Copied' : 'Copy report'}
        </button>
        <span className="field__label">
          Copy the report and paste it anywhere you need help — it contains no personal data, only endpoint
          names, HTTP statuses, and the field names each feed returned.
        </span>
      </div>

      {results.map((result) => (
        <article className="sourcecard" key={result.name}>
          <h3>
            <StatusTag status={result.status} /> {result.name}
          </h3>

          {result.status === 'pending' || result.status === 'running' ? (
            <p className="sourcecard__publisher">{result.status === 'running' ? 'Checking…' : 'Queued'}</p>
          ) : (
            <>
              <p className="sourcecard__publisher">
                {result.httpStatus !== undefined
                  ? `HTTP ${result.httpStatus} · ${result.rowCount ?? 0} rows · ${result.ms}ms`
                  : 'No response'}
              </p>

              {result.reason ? <p>{result.reason}</p> : null}

              {result.resolved && Object.keys(result.resolved).length ? (
                <ul>
                  {Object.entries(result.resolved).map(([purpose, field]) => (
                    <li key={purpose}>
                      {purpose} → <code>{field}</code>
                    </li>
                  ))}
                </ul>
              ) : null}

              {result.missing?.length ? (
                <>
                  <p>
                    <strong>No field matched for:</strong>
                  </p>
                  <ul>
                    {result.missing.map((entry) => (
                      <li key={entry.purpose}>
                        {entry.purpose} — tried <code>{entry.candidates.join(', ')}</code>
                      </li>
                    ))}
                  </ul>
                  <p>
                    <strong>Fields the feed actually returned:</strong>
                  </p>
                  <p>
                    <code>{result.fields?.join(', ')}</code>
                  </p>
                </>
              ) : null}
            </>
          )}
        </article>
      ))}

      {completed.length && !running ? (
        <article className="sourcecard">
          <h3>Report</h3>
          <p className="sourcecard__publisher">The same information as plain text, ready to paste.</p>
          <pre className="sourcenote__body">{report}</pre>
        </article>
      ) : null}
    </>
  );
}

function StatusTag({ status }: { status: Status }): ReactNode {
  const label = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'running' ? '···' : '—';
  const color =
    status === 'pass' ? 'var(--status-good)' : status === 'fail' ? 'var(--status-critical)' : 'var(--text-muted)';
  // Status never rides on color alone: the word is the signal, the color assists.
  return (
    <span style={{ color, fontFamily: 'var(--font-mono)', fontSize: '0.85em' }} aria-label={`Status: ${label}`}>
      {label}
    </span>
  );
}
