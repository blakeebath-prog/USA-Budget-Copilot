import type { ReactNode } from 'react';
import { Sparkline } from './charts/Sparkline';

export interface StatTileProps {
  label: string;
  value: string;
  /** Signed change against a named period, e.g. "+8.1% vs FY2024". */
  delta?: { text: string; direction: 'up' | 'down' | 'flat'; upIsGood: boolean };
  trend?: readonly number[];
  footnote?: string;
  /** The one number the view leads with. Exactly one per view. */
  hero?: boolean;
}

/**
 * A single current figure. A one-bar bar chart is never the right answer to
 * "show me this number" — this is.
 */
export function StatTile({ label, value, delta, trend, footnote, hero = false }: StatTileProps): ReactNode {
  const deltaClass = (() => {
    if (!delta || delta.direction === 'flat') return 'stat__delta';
    const good = delta.direction === 'up' ? delta.upIsGood : !delta.upIsGood;
    return `stat__delta ${good ? 'stat__delta--good' : 'stat__delta--bad'}`;
  })();

  return (
    <div className={hero ? 'stat stat--hero' : 'stat'}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {delta ? (
        <div className={deltaClass}>
          <span aria-hidden="true">{delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '■'}</span>{' '}
          {delta.text}
        </div>
      ) : null}
      {trend && trend.length > 1 ? <Sparkline values={trend} /> : null}
      {footnote ? <div className="stat__footnote">{footnote}</div> : null}
    </div>
  );
}
