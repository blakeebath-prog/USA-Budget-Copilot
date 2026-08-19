import type { ReactNode } from 'react';

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  color: string;
  /** Line key for lines, swatch for fills — mirrors the mark it describes. */
  markType?: 'line' | 'rect';
}

export interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: TooltipRow[];
  note?: string;
}

/**
 * One tooltip listing every series at the hovered position.
 *
 * Values lead and labels follow: the reader already knows which series they are
 * looking at and wants the number. All text goes in as React children, never as
 * markup — series names come from government feeds and are untrusted input.
 */
export function Tooltip({ state, width }: { state: TooltipState | null; width: number }): ReactNode {
  if (!state) return null;

  const flip = state.x > width * 0.6;
  const style: React.CSSProperties = {
    left: flip ? undefined : state.x + 14,
    right: flip ? width - state.x + 14 : undefined,
    top: Math.max(0, state.y - 12),
  };

  return (
    <div className="tooltip" style={style} role="status" aria-live="polite">
      <div className="tooltip__title">{state.title}</div>
      <div className="tooltip__rows">
        {state.rows.map((row) => (
          <div className="tooltip__row" key={row.key}>
            <span
              className={row.markType === 'rect' ? 'tooltip__swatch' : 'tooltip__linekey'}
              style={{ backgroundColor: row.color }}
              aria-hidden="true"
            />
            <span className="tooltip__value">{row.value}</span>
            <span className="tooltip__label">{row.label}</span>
          </div>
        ))}
      </div>
      {state.note ? <div className="tooltip__note">{state.note}</div> : null}
    </div>
  );
}
