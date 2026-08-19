import type { ReactNode } from 'react';

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  markType?: 'line' | 'rect';
}

/**
 * Identity is never carried by color alone: for two or more series the legend
 * is always present, and it mirrors the mark it describes — a stroke for lines,
 * a swatch for fills.
 */
export function Legend({ items }: { items: readonly LegendItem[] }): ReactNode {
  if (items.length < 2) return null;
  return (
    <ul className="legend">
      {items.map((item) => (
        <li className="legend__item" key={item.key}>
          <span
            className={item.markType === 'line' ? 'legend__linekey' : 'legend__swatch'}
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
