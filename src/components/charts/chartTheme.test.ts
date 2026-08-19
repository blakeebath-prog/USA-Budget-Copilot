import { describe, expect, it } from 'vitest';
import { createColorScale, foldTail, MAX_CATEGORICAL_SERIES, OTHER_COLOR, sequentialColor } from './chartTheme';

describe('createColorScale', () => {
  it('assigns slots in fixed order', () => {
    const scale = createColorScale(['defense', 'health', 'interest']);
    expect(scale('defense')).toBe('var(--series-1)');
    expect(scale('health')).toBe('var(--series-2)');
  });

  it('keeps an entity’s color when other entities are filtered out', () => {
    const full = createColorScale(['defense', 'health', 'interest']);
    const filtered = createColorScale(['defense', 'health', 'interest'].filter((key) => key !== 'health'));
    expect(filtered('defense')).toBe(full('defense'));
  });

  it('never invents a ninth hue', () => {
    const keys = Array.from({ length: MAX_CATEGORICAL_SERIES + 3 }, (_, index) => `series-${index}`);
    const scale = createColorScale(keys);
    expect(scale('series-8')).toBe(OTHER_COLOR);
    expect(scale('unknown-entity')).toBe(OTHER_COLOR);
  });
});

describe('foldTail', () => {
  const makeOther = (amount: number, count: number) => ({ label: `Other (${count})`, amount });

  it('leaves a short list alone', () => {
    const rows = [{ label: 'a', amount: 2 }];
    expect(foldTail(rows, 5, makeOther)).toEqual(rows);
  });

  it('folds everything past the limit into one row', () => {
    const rows = [
      { label: 'a', amount: 5 },
      { label: 'b', amount: 4 },
      { label: 'c', amount: 3 },
      { label: 'd', amount: 2 },
    ];
    expect(foldTail(rows, 2, makeOther)).toEqual([
      { label: 'a', amount: 5 },
      { label: 'b', amount: 4 },
      { label: 'Other (2)', amount: 5 },
    ]);
  });
});

describe('sequentialColor', () => {
  it('runs light to dark across the ramp', () => {
    expect(sequentialColor(0)).toBe('var(--seq-100)');
    expect(sequentialColor(1)).toBe('var(--seq-700)');
  });

  it('clamps out-of-range and non-finite input', () => {
    expect(sequentialColor(-4)).toBe('var(--seq-100)');
    expect(sequentialColor(9)).toBe('var(--seq-700)');
    expect(sequentialColor(Number.NaN)).toBe('var(--seq-100)');
  });
});
