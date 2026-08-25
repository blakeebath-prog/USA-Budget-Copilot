import { useMemo, useState, type ReactNode } from 'react';
import { scaleLinear, scalePoint } from 'd3-scale';
import { line as d3line, area as d3area, curveMonotoneX } from 'd3-shape';
import { Tooltip, type TooltipState } from './Tooltip';
import { useElementSize } from '../../hooks/useElementSize';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
}

export interface LinePoint {
  /** Stable identity for the x position. */
  x: string;
  /** What the reader sees on the axis and in the tooltip. */
  label: string;
  values: Record<string, number>;
}

export interface LineChartProps {
  points: readonly LinePoint[];
  series: readonly LineSeries[];
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  height?: number;
  /** Draw a 10% wash under the line. Only sensible for a single series. */
  area?: boolean;
  /** Draw a hairline at y = 0 when the data crosses it. */
  zeroLine?: boolean;
  /**
   * The x key where measurement stops and projection begins. From this point
   * the line is drawn dashed, so a reader can never mistake a forecast for a
   * record without having to consult a caption.
   */
  projectedFrom?: string;
  /** A labelled horizontal reference, e.g. today's level as a target to return to. */
  referenceLine?: { value: number; label: string };
}

const MARGIN = { top: 16, right: 56, bottom: 28, left: 64 };
const MIN_END_LABEL_GAP = 15;
const MIN_TICK_GAP_PX = 64;

export function LineChart({
  points,
  series,
  formatValue,
  formatTick,
  height = 280,
  area = false,
  zeroLine = false,
  projectedFrom,
  referenceLine,
}: LineChartProps): ReactNode {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const width = size.width || 640;
  const innerWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);

  const geometry = useMemo(() => {
    const x = scalePoint<string>()
      .domain(points.map((point) => point.x))
      .range([0, innerWidth]);

    const allValues = points.flatMap((point) =>
      series.map((entry) => point.values[entry.key]).filter((value): value is number => Number.isFinite(value)),
    );
    const min = allValues.length ? Math.min(...allValues) : 0;
    const max = allValues.length ? Math.max(...allValues) : 1;
    const lower = min > 0 ? 0 : min;
    const upper = max < 0 ? 0 : max;

    const y = scaleLinear()
      .domain([lower, upper === lower ? lower + 1 : upper])
      .nice(5)
      .range([innerHeight, 0]);

    return { x, y, ticks: y.ticks(5) };
  }, [points, series, innerWidth, innerHeight]);

  const { x, y, ticks } = geometry;

  const buildPath = (seriesKey: string, slice?: LinePoint[]): string => {
    const generator = d3line<LinePoint>()
      .defined((point) => Number.isFinite(point.values[seriesKey]))
      .x((point) => x(point.x) ?? 0)
      .y((point) => y(point.values[seriesKey] ?? 0))
      .curve(curveMonotoneX);
    return generator(slice ?? [...points]) ?? '';
  };

  // The two halves overlap by one point so the solid and dashed strokes meet
  // rather than leaving a gap at the boundary.
  const boundary = projectedFrom === undefined ? -1 : points.findIndex((point) => point.x === projectedFrom);
  const measuredSlice = boundary > 0 ? points.slice(0, boundary + 1) : null;
  const projectedSlice = boundary > 0 ? points.slice(boundary) : null;

  const buildArea = (seriesKey: string): string => {
    const generator = d3area<LinePoint>()
      .defined((point) => Number.isFinite(point.values[seriesKey]))
      .x((point) => x(point.x) ?? 0)
      .y0(y(Math.max(0, y.domain()[0] ?? 0)))
      .y1((point) => y(point.values[seriesKey] ?? 0))
      .curve(curveMonotoneX);
    return generator([...points]) ?? '';
  };

  const axisEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerWidth / 84))));

  /**
   * Which x positions get a tick label.
   *
   * The last point always earns one — it is the value the reader came for — but
   * only if the evenly spaced label before it is far enough away. Drawing both
   * regardless is how the right edge ends up with two labels printed on top of
   * each other.
   */
  const tickIndices = (() => {
    const indices: number[] = [];
    for (let index = 0; index < points.length; index += axisEvery) indices.push(index);
    const last = points.length - 1;
    const previous = indices[indices.length - 1];
    if (previous === undefined) return [last];
    const spacing = points.length > 1 ? innerWidth / (points.length - 1) : innerWidth;
    if (last - previous >= Math.ceil(MIN_TICK_GAP_PX / Math.max(spacing, 1))) indices.push(last);
    else indices[indices.length - 1] = last;
    return indices;
  })();

  // End labels only survive when the lines actually separate at the right edge;
  // nudging collided labels apart detaches them from their lines.
  const endLabels = (() => {
    const last = points[points.length - 1];
    if (!last || series.length > 4) return [];
    const candidates = series
      .map((entry) => ({ entry, value: last.values[entry.key] }))
      .filter((candidate): candidate is { entry: LineSeries; value: number } => Number.isFinite(candidate.value))
      .map((candidate) => ({ ...candidate, y: y(candidate.value) }))
      .sort((a, b) => a.y - b.y);
    for (let index = 1; index < candidates.length; index += 1) {
      const current = candidates[index];
      const previous = candidates[index - 1];
      if (current && previous && current.y - previous.y < MIN_END_LABEL_GAP) return [];
    }
    return candidates;
  })();

  const handleMove = (event: React.PointerEvent<SVGRectElement>) => {
    if (points.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - bounds.left;
    const step = points.length > 1 ? innerWidth / (points.length - 1) : innerWidth;
    const index = Math.min(points.length - 1, Math.max(0, Math.round(offsetX / (step || 1))));
    const point = points[index];
    if (!point) return;

    setActiveIndex(index);
    setTooltip({
      x: MARGIN.left + (x(point.x) ?? 0),
      y: MARGIN.top + 8,
      title: boundary > 0 && index >= boundary ? `${point.label} · projected` : point.label,
      rows: series
        .filter((entry) => Number.isFinite(point.values[entry.key]))
        .map((entry) => ({
          key: entry.key,
          label: entry.label,
          value: formatValue(point.values[entry.key] ?? 0),
          color: entry.color,
          markType: 'line' as const,
        })),
    });
  };

  const clear = () => {
    setTooltip(null);
    setActiveIndex(null);
  };

  const activePoint = activeIndex === null ? null : points[activeIndex];

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Line chart">
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {ticks.map((tick) => (
            <g key={tick} transform={`translate(0,${y(tick)})`}>
              <line className="chart__grid" x1={0} x2={innerWidth} />
              <text className="chart__tick chart__tick--y" x={-10} dy="0.32em" textAnchor="end">
                {(formatTick ?? formatValue)(tick)}
              </text>
            </g>
          ))}

          {zeroLine && (y.domain()[0] ?? 0) < 0 ? (
            <line className="chart__baseline" x1={0} x2={innerWidth} y1={y(0)} y2={y(0)} />
          ) : null}

          {area && series[0]
            ? (() => {
                const only = series[0];
                return <path d={buildArea(only.key)} fill={only.color} opacity={0.1} />;
              })()
            : null}

          {series.map((entry) =>
            measuredSlice && projectedSlice ? (
              <g key={entry.key}>
                <path
                  d={buildPath(entry.key, measuredSlice)}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={buildPath(entry.key, projectedSlice)}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ) : (
              <path
                key={entry.key}
                d={buildPath(entry.key)}
                fill="none"
                stroke={entry.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}

          {referenceLine && Number.isFinite(referenceLine.value) ? (
            <g>
              <line
                className="chart__reference"
                x1={0}
                x2={innerWidth}
                y1={y(referenceLine.value)}
                y2={y(referenceLine.value)}
              />
              <text className="chart__referencelabel" x={4} y={y(referenceLine.value) - 6}>
                {referenceLine.label}
              </text>
            </g>
          ) : null}

          {boundary > 0 && points[boundary] ? (
            <line
              className="chart__boundary"
              x1={x(points[boundary]?.x ?? '') ?? 0}
              x2={x(points[boundary]?.x ?? '') ?? 0}
              y1={0}
              y2={innerHeight}
            />
          ) : null}

          {activePoint ? (
            <g>
              <line
                className="chart__crosshair"
                x1={x(activePoint.x) ?? 0}
                x2={x(activePoint.x) ?? 0}
                y1={0}
                y2={innerHeight}
              />
              {series
                .filter((entry) => Number.isFinite(activePoint.values[entry.key]))
                .map((entry) => (
                  <circle
                    key={entry.key}
                    cx={x(activePoint.x) ?? 0}
                    cy={y(activePoint.values[entry.key] ?? 0)}
                    r={4}
                    fill={entry.color}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  />
                ))}
            </g>
          ) : null}

          {endLabels.map((label) => (
            <text
              key={label.entry.key}
              className="chart__endlabel"
              x={innerWidth + 8}
              y={label.y}
              dy="0.32em"
            >
              {formatValue(label.value)}
            </text>
          ))}

          {tickIndices.map((index) => {
            const point = points[index];
            if (!point) return null;
            return (
              <text
                key={point.x}
                className="chart__tick"
                x={x(point.x) ?? 0}
                y={innerHeight + 18}
                textAnchor="middle"
              >
                {point.label}
              </text>
            );
          })}

          <line className="chart__axis" x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} />

          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={handleMove}
            onPointerLeave={clear}
          />
        </g>
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
