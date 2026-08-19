import { useMemo, useState, type ReactNode } from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { Tooltip, type TooltipState } from './Tooltip';
import { useElementSize } from '../../hooks/useElementSize';
import { barThickness, roundedBarPath } from './barGeometry';

export interface Column {
  key: string;
  label: string;
  value: number;
  color?: string;
  note?: string;
}

export interface ColumnChartProps {
  columns: readonly Column[];
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  height?: number;
  /** Highlight one column and gray the rest — emphasis, when one year is the story. */
  emphasisKey?: string | null;
  /** Paint values below the baseline in the opposite hue. Opt in only where the sign is the story. */
  diverging?: boolean;
}

const MARGIN = { top: 24, right: 12, bottom: 30, left: 64 };

/**
 * Vertical columns over an ordered axis — fiscal years, quarters, months.
 *
 * Values that cross zero take the diverging pair (blue below, red above) with a
 * neutral baseline, because for a deficit series the sign is the whole point.
 */
export function ColumnChart({
  columns,
  formatValue,
  formatTick,
  height = 300,
  emphasisKey = null,
  diverging = false,
}: ColumnChartProps): ReactNode {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const width = size.width || 720;
  const innerWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);

  const { x, y, ticks } = useMemo(() => {
    const values = columns.map((column) => column.value).filter((value) => Number.isFinite(value));
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const scaleY = scaleLinear()
      .domain([min, max === min ? min + 1 : max])
      .nice(5)
      .range([innerHeight, 0]);
    const scaleX = scaleBand<string>()
      .domain(columns.map((column) => column.key))
      .range([0, innerWidth])
      .paddingInner(0.25);
    return { x: scaleX, y: scaleY, ticks: scaleY.ticks(5) };
  }, [columns, innerWidth, innerHeight]);

  const baseline = y(0);
  const axisEvery = Math.max(1, Math.ceil(columns.length / Math.max(2, Math.floor(innerWidth / 56))));

  const fillFor = (column: Column): string => {
    if (emphasisKey) return column.key === emphasisKey ? 'var(--series-1)' : 'var(--deemphasis)';
    if (column.color) return column.color;
    if (!diverging) return 'var(--series-1)';
    return column.value < 0 ? 'var(--div-neg)' : 'var(--div-pos)';
  };

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Column chart">
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {ticks.map((tick) => (
            <g key={tick} transform={`translate(0,${y(tick)})`}>
              <line className="chart__grid" x1={0} x2={innerWidth} />
              <text className="chart__tick chart__tick--y" x={-10} dy="0.32em" textAnchor="end">
                {(formatTick ?? formatValue)(tick)}
              </text>
            </g>
          ))}
          <line className="chart__axis" x1={0} x2={innerWidth} y1={baseline} y2={baseline} />

          {columns.map((column, index) => {
            const bandLeft = x(column.key) ?? 0;
            const thickness = barThickness(x.bandwidth(), 40);
            const centre = bandLeft + x.bandwidth() / 2;
            const valueText = formatValue(column.value);
            return (
              <g
                key={column.key}
                tabIndex={0}
                role="img"
                aria-label={`${column.label}: ${valueText}`}
                className="chart__colgroup"
                onPointerMove={(event) => {
                  const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
                  setTooltip({
                    x: bounds ? event.clientX - bounds.left : MARGIN.left + centre,
                    y: MARGIN.top + 4,
                    title: column.label,
                    rows: [
                      {
                        key: column.key,
                        label: 'Amount',
                        value: valueText,
                        color: fillFor(column),
                        markType: 'rect',
                      },
                    ],
                    ...(column.note ? { note: column.note } : {}),
                  });
                }}
                onFocus={() =>
                  setTooltip({
                    x: MARGIN.left + centre,
                    y: MARGIN.top + 4,
                    title: column.label,
                    rows: [
                      { key: column.key, label: 'Amount', value: valueText, color: fillFor(column), markType: 'rect' },
                    ],
                    ...(column.note ? { note: column.note } : {}),
                  })
                }
                onPointerLeave={() => setTooltip(null)}
                onBlur={() => setTooltip(null)}
              >
                <rect x={bandLeft} y={0} width={x.bandwidth()} height={innerHeight} fill="transparent" />
                <path
                  d={roundedBarPath({
                    baseline,
                    value: y(column.value),
                    crossStart: centre - thickness / 2,
                    thickness,
                    orientation: 'vertical',
                  })}
                  fill={fillFor(column)}
                />
                {index % axisEvery === 0 || index === columns.length - 1 ? (
                  <text
                    className="chart__tick"
                    x={centre}
                    y={innerHeight + 18}
                    textAnchor="middle"
                  >
                    {column.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
