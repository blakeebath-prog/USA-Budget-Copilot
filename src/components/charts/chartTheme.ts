/**
 * Series colors.
 *
 * Slots are assigned in fixed order from a stable list of entity keys, so a
 * filter that removes series never repaints the survivors — a reader who
 * learned "Defense is blue" keeps that. Past eight entities the tail folds into
 * a single "Other" gray rather than inventing a ninth hue.
 */
export const SERIES_SLOTS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const;

export const MAX_CATEGORICAL_SERIES = SERIES_SLOTS.length;

/** Forms that put every pair on screen at once (scatter, treemap, map) cap at three. */
export const MAX_ALL_PAIRS_SERIES = 3;

export const OTHER_COLOR = 'var(--deemphasis)';
export const OTHER_LABEL = 'Other';

export interface ColorScale {
  (key: string): string;
  readonly keys: readonly string[];
}

export function createColorScale(orderedKeys: readonly string[]): ColorScale {
  const assignments = new Map<string, string>();
  orderedKeys.forEach((key, index) => {
    const slot = SERIES_SLOTS[index];
    assignments.set(key, slot ?? OTHER_COLOR);
  });

  const scale = ((key: string) => assignments.get(key) ?? OTHER_COLOR) as ColorScale & { keys: readonly string[] };
  Object.defineProperty(scale, 'keys', { value: orderedKeys, enumerable: true });
  return scale;
}

/**
 * Keep the largest `limit` entries and fold the rest into one "Other" row, so a
 * long tail never becomes a ninth hue.
 */
export function foldTail<T extends { amount: number }>(
  rows: readonly T[],
  limit: number,
  makeOther: (amount: number, count: number) => T,
): T[] {
  if (rows.length <= limit) return [...rows];
  const head = rows.slice(0, limit);
  const tail = rows.slice(limit);
  const tailTotal = tail.reduce((sum, row) => sum + row.amount, 0);
  return [...head, makeOther(tailTotal, tail.length)];
}

/** Sequential ramp steps, light → dark, for magnitude encoding. */
export const SEQUENTIAL_STEPS = [
  'var(--seq-100)',
  'var(--seq-200)',
  'var(--seq-300)',
  'var(--seq-400)',
  'var(--seq-500)',
  'var(--seq-600)',
  'var(--seq-700)',
] as const;

export function sequentialColor(normalized: number): string {
  if (!Number.isFinite(normalized)) return SEQUENTIAL_STEPS[0];
  const clamped = Math.min(1, Math.max(0, normalized));
  const index = Math.round(clamped * (SEQUENTIAL_STEPS.length - 1));
  return SEQUENTIAL_STEPS[index] ?? SEQUENTIAL_STEPS[0];
}
