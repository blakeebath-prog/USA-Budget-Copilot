import { useState, type ReactNode } from 'react';
import { getSource } from '../lib/sources';
import type { Provenance } from '../lib/http';
import { timestampLabel } from '../lib/format';

/**
 * Provenance for one figure or chart.
 *
 * Every chart in this app carries one. A budget number without a traceable
 * source is an opinion, so the exact endpoint, the retrieval time, and the
 * caveats that would make a reader misread the figure all stay one click away.
 */
export function SourceNote({ provenance }: { provenance: Provenance | null }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (!provenance) return null;

  const source = getSource(provenance.sourceId);
  const originLabel =
    provenance.origin === 'snapshot'
      ? 'from a local snapshot'
      : provenance.origin === 'memory-cache'
        ? 'cached this session'
        : 'fetched live';

  return (
    <div className="sourcenote">
      <button
        type="button"
        className="sourcenote__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="sourcenote__marker" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        Source: {source.name}
      </button>
      <span className="sourcenote__meta">
        {source.publisher} · {originLabel} {timestampLabel(provenance.retrievedAt)}
      </span>

      {expanded ? (
        <div className="sourcenote__detail">
          <p className="sourcenote__covers">{source.covers}</p>
          <p className="sourcenote__cadence">
            <strong>Updated:</strong> {source.updateCadence}
          </p>
          <ul className="sourcenote__caveats">
            {source.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
          <p className="sourcenote__endpoint">
            <code>
              {provenance.method} {provenance.url}
            </code>
          </p>
          {provenance.requestBody ? (
            <pre className="sourcenote__body">{JSON.stringify(provenance.requestBody, null, 2)}</pre>
          ) : null}
          <p>
            <a href={source.homepage} target="_blank" rel="noreferrer noopener">
              Open the publisher's page for this dataset →
            </a>
          </p>
        </div>
      ) : null}
    </div>
  );
}
