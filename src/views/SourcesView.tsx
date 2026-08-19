import type { ReactNode } from 'react';
import { SOURCES } from '../lib/sources';
import { getDataMode } from '../lib/http';

interface Alternative {
  name: string;
  publisher: string;
  url: string;
  verdict: string;
  detail: string;
}

/**
 * Sources actually wired in, plus the ones evaluated and left out.
 *
 * Saying why a source was rejected is as much a part of provenance as citing
 * the ones used — otherwise a reader cannot tell what this tool is blind to.
 */
const ALTERNATIVES: Alternative[] = [
  {
    name: 'OMB Public Budget Database and Historical Tables',
    publisher: 'Office of Management and Budget',
    url: 'https://www.whitehouse.gov/omb/budget/',
    verdict: 'Best source for enacted and proposed budget authority. No API.',
    detail:
      'Account-level budget authority and outlays back to 1962, published as spreadsheets alongside each President’s Budget. This is the only authoritative source for what was appropriated, as opposed to what was spent — but it ships as XLSX once a year, so it belongs in a scheduled ingest rather than a live API call.',
  },
  {
    name: 'CBO Budget and Economic Outlook data files',
    publisher: 'Congressional Budget Office',
    url: 'https://www.cbo.gov/data/budget-economic-data',
    verdict: 'The source for projections. No API; well-structured workbooks.',
    detail:
      'Nothing in this app is a forecast: every figure is something that already happened. CBO is where ten-year baseline projections come from, published as Excel workbooks with each Outlook. CBO also maintains a GitHub repository of standardized CSV extracts.',
  },
  {
    name: 'Bureau of Economic Analysis API',
    publisher: 'U.S. Department of Commerce',
    url: 'https://apps.bea.gov/API/signup/',
    verdict: 'Needed for spending as a share of GDP. Requires a free API key.',
    detail:
      'GDP is the denominator that makes budget figures comparable across decades — a trillion dollars in 1985 and in 2025 are not the same quantity. BEA has a proper JSON API, but it requires a registered key, so it is deliberately not a hard dependency of the default build.',
  },
  {
    name: 'FRED',
    publisher: 'Federal Reserve Bank of St. Louis',
    url: 'https://fred.stlouisfed.org/docs/api/fred/',
    verdict: 'Convenient mirror, not a primary source. Requires an API key.',
    detail:
      'FRED republishes Treasury, BEA, and CBO series with a good API and long histories. It is a redistributor, so for a tool whose premise is primary sources it is a fallback, not the origin.',
  },
  {
    name: 'GovInfo Budget of the U.S. Government',
    publisher: 'U.S. Government Publishing Office',
    url: 'https://www.govinfo.gov/app/collection/budget',
    verdict: 'Authoritative documents, not analysis-ready data. API key required.',
    detail:
      'The Budget Appendix and supporting volumes as published. Useful for citing exact appropriations language; the tables inside are PDFs, so this is a documentation source rather than a data feed.',
  },
];

export function SourcesView(): ReactNode {
  const mode = getDataMode();

  return (
    <>
      <p className="view__intro">
        Every figure in this tool comes from one of the feeds below. Nothing is modelled, estimated, adjusted for
        inflation, or projected — if a number is not published by the government, it is not shown.
      </p>

      <div className="banner">
        Data mode: <code>{mode}</code>.{' '}
        {mode === 'proxy'
          ? 'Requests go through the local dev server to the government APIs.'
          : mode === 'direct'
            ? 'The browser calls the government APIs directly.'
            : 'Reading pre-fetched snapshots from /data. Nothing is live.'}
      </div>

      <h2>Feeds this tool reads</h2>
      {Object.values(SOURCES).map((source) => (
        <article className="sourcecard" key={source.id}>
          <h3>{source.name}</h3>
          <p className="sourcecard__publisher">{source.publisher}</p>
          <p>{source.covers}</p>
          <p>
            <strong>Updated:</strong> {source.updateCadence}
          </p>
          <p>
            <strong>Read this carefully before quoting a number:</strong>
          </p>
          <ul>
            {source.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
          <p>
            <a href={source.homepage} target="_blank" rel="noreferrer noopener">
              {source.homepage}
            </a>
          </p>
        </article>
      ))}

      <h2>Evaluated and not wired in</h2>
      {ALTERNATIVES.map((alternative) => (
        <article className="sourcecard" key={alternative.name}>
          <h3>{alternative.name}</h3>
          <p className="sourcecard__publisher">
            {alternative.publisher} · {alternative.verdict}
          </p>
          <p>{alternative.detail}</p>
          <p>
            <a href={alternative.url} target="_blank" rel="noreferrer noopener">
              {alternative.url}
            </a>
          </p>
        </article>
      ))}

      <h2>What this tool cannot tell you</h2>
      <article className="sourcecard">
        <ul>
          <li>
            <strong>What was appropriated.</strong> Every figure here is money spent, committed, or owed. Enacted
            appropriations live in the OMB database and the Budget Appendix.
          </li>
          <li>
            <strong>What will happen.</strong> There are no projections anywhere in this tool.
          </li>
          <li>
            <strong>Inflation-adjusted comparisons.</strong> All dollars are nominal, as published. A 1990 dollar
            and a 2026 dollar are shown at face value.
          </li>
          <li>
            <strong>Whether spending was worthwhile.</strong> These feeds record amounts and recipients, not
            outcomes.
          </li>
        </ul>
      </article>
    </>
  );
}
