import { useMemo, useState, type ReactNode } from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { Tooltip, type TooltipState } from './Tooltip';
import { useElementSize } from '../../hooks/useElementSize';
import { barThickness, estimateTextWidth, labelFitsInside, roundedBarPath } from './barGeometry';

export interface Bar {
  key: string;
  label: string;
  value: number;
  /** Overrides the default single-hue fill; used when bars carry entity identity. */
  color?: string;
  /** Extra line in the tooltip, e.g. a share of total. */
  note?: string;
}

export interface BarChartProps {
  bars: readonly Bar[];
  formatValue: (value: number) => string;
  /** Width reserved for category names on the left. */
  labelWidth?: number;
  rowHeight?: number;
  onSelect?: (bar: Bar) => void;
  selectedKey?: string | null;
  /**
   * Paint negative bars in the opposite diverging hue. Opt in only where the
   * sign is the story — a surplus against a deficit. A category that happens to
   * go negative because it nets out refunds is not a polarity, and coloring it
   * red would say something the data does not.
   */
  diverging?: boolean;
}

const MARGIN = { top: 4, right: 76, bottom: 26, left: 8 };

/**
 * Horizontal bars — the default for magnitude with long category names.
 *
 * One series means one color, never a value ramp: bar length already encodes
 * magnitude, so darkening by size double-encodes it and burns the free channel.
 * A bar that runs the other way off the baseline already reads as negative
 * without a second hue, so diverging color is opt-in rather than automatic.
 */
export function BarChart({
  bars,
  formatValue,
  labelWidth = 210,
  rowHeight = 30,
  onSelect,
  selectedKey = null,
  diverging = false,
}: BarChartProps): ReactNode {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const height = bars.length * rowHeight + MARGIN.top + MARGIN.bottom;
  const width = size.width || 720;
  const plotLeft = MARGIN.left + labelWidth;
  const innerWidth = Math.max(10, width - plotLeft - MARGIN.right);
  const innerHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);

  const { x, y, ticks } = useMemo(() => {
    const values = bars.map((bar) => bar.value).filter((value) => Number.isFinite(value));
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const scaleX = scaleLinear()
      .domain([min, max === min ? min + 1 : max])
      .nice(4)
      .range([0, innerWidth]);
    const scaleY = scaleBand<string>()
      .domain(bars.map((bar) => bar.key))
      .range([0, innerHeight])
      .paddingInner(0.2);
    return { x: scaleX, y: scaleY, ticks: scaleX.ticks(4) };
  }, [bars, innerWidth, innerHeight]);

  const baseline = x(0);

  const fillFor = (bar: Bar): string => {
    if (bar.color) return bar.color;
    if (!diverging) return 'var(--series-1)';
    return bar.value < 0 ? 'var(--div-neg)' : 'var(--div-pos)';
  };

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Bar chart">
        <g transform={`translate(${plotLeft},${MARGIN.top})`}>
          {ticks.map((tick) => (
            <line key={tick} className="chart__grid" x1={x(tick)} x2={x(tick)} y1={0} y2={innerHeight} />
          ))}
          <line className="chart__axis" x1={baseline} x2={baseline} y1={0} y2={innerHeight} />
        </g>

        {bars.map((bar) => {
          const bandTop = (y(bar.key) ?? 0) + MARGIN.top;
          const thickness = barThickness(y.bandwidth());
          const centre = bandTop + y.bandwidth() / 2;
          const valueX = x(bar.value);
          const length = Math.abs(valueX - baseline);
          const valueText = formatValue(bar.value);
          const inside = labelFitsInside(length, estimateTextWidth(valueText));
          const tipX = plotLeft + valueX;
          const selected = selectedKey === bar.key;

          return (
            <g
              key={bar.key}
              className={`chart__barrow${selected ? ' is-selected' : ''}${onSelect ? ' is-clickable' : ''}`}
              tabIndex={0}
              role={onSelect ? 'button' : 'img'}
              aria-label={`${bar.label}: ${valueText}`}
              onClick={() => onSelect?.(bar)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(bar);
                }
              }}
              onPointerMove={(event) => {
                const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
                setTooltip({
                  x: bounds ? event.clientX - bounds.left : tipX,
                  y: centre,
                  title: bar.label,
                  rows: [
                    {
                      key: bar.key,
                      label: 'Amount',
                      value: valueText,
                      color: fillFor(bar),
                      markType: 'rect',
                    },
                  ],
                  ...(bar.note ? { note: bar.note } : {}),
                });
              }}
              onFocus={() =>
                setTooltip({
                  x: tipX,
                  y: centre,
                  title: bar.label,
                  rows: [
                    { key: bar.key, label: 'Amount', value: valueText, color: fillFor(bar), markType: 'rect' },
                  ],
                  ...(bar.note ? { note: bar.note } : {}),
                })
              }
              onPointerLeave={() => setTooltip(null)}
              onBlur={() => setTooltip(null)}
            >
              <rect x={0} y={bandTop} width={width} height={y.bandwidth()} fill="transparent" />
              <text
                className="chart__barlabel"
                x={MARGIN.left}
                y={centre}
                dy="0.32em"
                textAnchor="start"
              >
                {truncate(bar.label, labelWidth)}
              </text>
              <path
                transform={`translate(${plotLeft},0)`}
                d={roundedBarPath({
                  baseline,
                  value: valueX,
                  crossStart: centre - thickness / 2,
                  thickness,
                  orientation: 'horizontal',
                })}
                fill={fillFor(bar)}
              />
              <text
                className={inside ? 'chart__value chart__value--inside' : 'chart__value'}
                x={
                  inside
                    ? tipX - (bar.value < 0 ? -8 : 8)
                    : tipX + (bar.value < 0 ? -8 : 8)
                }
                y={centre}
                dy="0.32em"
                textAnchor={bar.value < 0 ? (inside ? 'start' : 'end') : inside ? 'end' : 'start'}
              >
                {valueText}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}

/** Category names come from federal feeds and run long; clip by measure, never by CSS overflow. */
function truncate(label: string, availableWidth: number, fontSize = 12): string {
  const maxChars = Math.max(6, Math.floor(availableWidth / (fontSize * 0.56)));
  return label.length <= maxChars ? label : `${label.slice(0, maxChars - 1).trimEnd()}…`;
}
