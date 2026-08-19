import { useState, type ReactNode } from 'react';
import { SourceNote } from './SourceNote';
import { Legend, type LegendItem } from './charts/Legend';
import type { Provenance } from '../lib/http';
import { ApiError } from '../lib/http';
import { SchemaMismatchError } from '../lib/api/fieldResolution';

export interface PanelProps {
  title: string;
  subtitle?: string;
  provenance?: Provenance | null;
  legend?: readonly LegendItem[];
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  /** Rendered when the reader switches to the table view. */
  table?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}

/**
 * The frame every chart lives in: title, legend, chart/table toggle, and the
 * source note. While data reloads the previous render stays put at reduced
 * opacity — no skeleton, no layout jump.
 */
export function Panel({
  title,
  subtitle,
  provenance = null,
  legend,
  loading = false,
  error = null,
  onRetry,
  table,
  children,
  wide = false,
}: PanelProps): ReactNode {
  const [view, setView] = useState<'chart' | 'table'>('chart');

  return (
    <section className={wide ? 'panel panel--wide' : 'panel'}>
      <header className="panel__header">
        <div>
          <h2 className="panel__title">{title}</h2>
          {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
        </div>
        {table ? (
          <div className="panel__views" role="group" aria-label={`${title} view`}>
            <button
              type="button"
              className={view === 'chart' ? 'toggle is-active' : 'toggle'}
              onClick={() => setView('chart')}
              aria-pressed={view === 'chart'}
            >
              Chart
            </button>
            <button
              type="button"
              className={view === 'table' ? 'toggle is-active' : 'toggle'}
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
            >
              Table
            </button>
          </div>
        ) : null}
      </header>

      {legend && legend.length > 1 ? <Legend items={legend} /> : null}

      <div className={loading ? 'panel__body is-loading' : 'panel__body'}>
        {error ? <ErrorState error={error} onRetry={onRetry} /> : view === 'table' && table ? table : children}
      </div>

      <footer className="panel__footer">
        <SourceNote provenance={provenance} />
      </footer>
    </section>
  );
}

/**
 * Failures name the call that failed.
 *
 * A blank chart teaches the reader nothing. A schema mismatch means the feed
 * renamed a column and the app must be pointed at the new one; a network error
 * usually means the browser could not reach the API at all. The two need very
 * different fixes, so they are worded differently.
 */
function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }): ReactNode {
  const isSchema = error instanceof SchemaMismatchError;
  const isApi = error instanceof ApiError;

  return (
    <div className="errorstate" role="alert">
      <p className="errorstate__headline">
        {isSchema
          ? 'This feed changed shape, so the figures are not being shown.'
          : 'Could not load this data from the government API.'}
      </p>
      <p className="errorstate__detail">{error.message}</p>
      {isApi && error.status === undefined ? (
        <p className="errorstate__hint">
          A request that fails with no HTTP status is usually the browser being blocked before it reached the
          API — a network policy, an offline machine, or CORS. Try <code>VITE_DATA_MODE=proxy</code> with{' '}
          <code>npm run dev</code>, or <code>VITE_DATA_MODE=snapshot</code> after <code>npm run ingest</code>.
        </p>
      ) : null}
      {isSchema ? (
        <p className="errorstate__hint">
          Run <code>npm run verify:sources</code> to print the columns the feed returns today, then add the new
          name to the candidate list in <code>src/lib/api/</code>.
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
