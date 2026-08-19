import type { ReactNode } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3line, curveMonotoneX } from 'd3-shape';

/** 12-point trend line for a stat tile: context in the de-emphasis hue, current point in the accent. */
export function Sparkline({
  values,
  width = 108,
  height = 28,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
}): ReactNode {
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length < 2) return null;

  const x = scaleLinear().domain([0, points.length - 1]).range([1, width - 1]);
  const y = scaleLinear()
    .domain([Math.min(...points), Math.max(...points)])
    .range([height - 3, 3]);

  const path =
    d3line<number>()
      .x((_, index) => x(index))
      .y((value) => y(value))
      .curve(curveMonotoneX)(points as number[]) ?? '';

  const lastValue = points[points.length - 1] ?? 0;

  return (
    <svg className="sparkline" width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke="var(--deemphasis)" strokeWidth={2} strokeLinecap="round" />
      <circle
        cx={x(points.length - 1)}
        cy={y(lastValue)}
        r={4}
        fill="var(--series-1)"
        stroke="var(--surface-1)"
        strokeWidth={2}
      />
    </svg>
  );
}
