/**
 * Bar path geometry: rounded at the data end, square at the baseline.
 *
 * The rounding marks where the value stops, so it belongs only on the growing
 * end; a bar rounded at the baseline reads as floating off its axis.
 */
export interface RoundedBarSpec {
  /** Coordinate of the baseline (zero) along the value axis. */
  baseline: number;
  /** Coordinate of the value end along the value axis. */
  value: number;
  /** Start of the bar along the category axis. */
  crossStart: number;
  /** Thickness of the bar along the category axis. */
  thickness: number;
  orientation: 'horizontal' | 'vertical';
  radius?: number;
}

export function roundedBarPath(spec: RoundedBarSpec): string {
  const { baseline, value, crossStart, thickness, orientation } = spec;
  const length = Math.abs(value - baseline);
  const radius = Math.min(spec.radius ?? 4, length, thickness / 2);
  const direction = value >= baseline ? 1 : -1;

  if (length < 0.5) return '';

  if (orientation === 'horizontal') {
    const y0 = crossStart;
    const y1 = crossStart + thickness;
    const tip = value;
    const preTip = tip - direction * radius;
    const sweep = direction > 0 ? 1 : 0;
    return [
      `M ${baseline} ${y0}`,
      `L ${preTip} ${y0}`,
      `A ${radius} ${radius} 0 0 ${sweep} ${preTip + direction * radius} ${y0 + radius}`,
      `L ${tip} ${y1 - radius}`,
      `A ${radius} ${radius} 0 0 ${sweep} ${preTip} ${y1}`,
      `L ${baseline} ${y1}`,
      'Z',
    ].join(' ');
  }

  const x0 = crossStart;
  const x1 = crossStart + thickness;
  const tip = value;
  const preTip = tip - direction * radius;
  const sweep = direction > 0 ? 0 : 1;
  return [
    `M ${x0} ${baseline}`,
    `L ${x0} ${preTip}`,
    `A ${radius} ${radius} 0 0 ${sweep} ${x0 + radius} ${preTip + direction * radius}`,
    `L ${x1 - radius} ${tip}`,
    `A ${radius} ${radius} 0 0 ${sweep} ${x1} ${preTip}`,
    `L ${x1} ${baseline}`,
    'Z',
  ].join(' ');
}

/**
 * Bar thickness inside a band: capped at 24px, and always leaving at least a
 * 2px surface gap between neighbours so touching bars separate without a stroke.
 */
export function barThickness(bandwidth: number, cap = 24, minGap = 2): number {
  return Math.max(1, Math.min(cap, bandwidth - minGap));
}

/** Does a label of `textWidth` fit inside a bar of `length` with padding on both sides? */
export function labelFitsInside(length: number, textWidth: number, padding = 8): boolean {
  return length >= textWidth + padding * 2;
}

/** Rough advance width for the chart's own label sizes. Good enough to decide in/out placement. */
export function estimateTextWidth(text: string, fontSize = 12): number {
  return text.length * fontSize * 0.58;
}
