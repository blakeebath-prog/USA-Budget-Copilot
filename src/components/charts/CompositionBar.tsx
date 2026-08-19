import { useState, type ReactNode } from 'react';
import { Tooltip, type TooltipState } from './Tooltip';
import { useElementSize } from '../../hooks/useElementSize';
import { estimateTextWidth, labelFitsInside } from './barGeometry';

export interface CompositionSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * One horizontal stacked bar: part-to-whole at a glance.
 *
 * Segments are separated by a 2px gap in the surface color — never a stroke,
 * which would add ink that isn't data. An interior segment whose label will not
 * fit gets no inline label; the legend, tooltip, and table view carry it.
 */
export function CompositionBar({
  segments,
  formatValue,
  height = 44,
}: {
  segments: readonly CompositionSegment[];
  formatValue: (value: number) => string;
  height?: number;
}): ReactNode {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const width = size.width || 720;
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const GAP = 2;

  let cursor = 0;
  const laid = segments.map((segment) => {
    const share = total > 0 ? Math.max(0, segment.value) / total : 0;
    const segmentWidth = Math.max(0, share * (width - GAP * Math.max(0, segments.length - 1)));
    const x = cursor;
    cursor += segmentWidth + GAP;
    return { segment, x, width: segmentWidth, share };
  });

  return (
    <div className="chart chart--composition" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Composition bar">
        {laid.map(({ segment, x, width: segmentWidth, share }) => {
          const label = `${(share * 100).toFixed(0)}%`;
          const fits = labelFitsInside(segmentWidth, estimateTextWidth(label, 11), 4);
          return (
            <g
              key={segment.key}
              tabIndex={0}
              role="img"
              aria-label={`${segment.label}: ${formatValue(segment.value)}, ${label} of total`}
              onPointerMove={(event) => {
                const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
                setTooltip({
                  x: bounds ? event.clientX - bounds.left : x,
                  y: 4,
                  title: segment.label,
                  rows: [
                    {
                      key: segment.key,
                      label: `${label} of total`,
                      value: formatValue(segment.value),
                      color: segment.color,
                      markType: 'rect',
                    },
                  ],
                });
              }}
              onFocus={() =>
                setTooltip({
                  x,
                  y: 4,
                  title: segment.label,
                  rows: [
                    {
                      key: segment.key,
                      label: `${label} of total`,
                      value: formatValue(segment.value),
                      color: segment.color,
                      markType: 'rect',
                    },
                  ],
                })
              }
              onPointerLeave={() => setTooltip(null)}
              onBlur={() => setTooltip(null)}
            >
              <rect x={x} y={0} width={segmentWidth} height={height} rx={2} fill={segment.color} />
              {fits ? (
                <text className="chart__segmentlabel" x={x + segmentWidth / 2} y={height / 2} dy="0.32em">
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <Tooltip state={tooltip} width={width} />
    </div>
  );
}
