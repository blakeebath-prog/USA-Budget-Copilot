import { describe, expect, it } from 'vitest';
import { barThickness, estimateTextWidth, labelFitsInside, roundedBarPath } from './barGeometry';

describe('roundedBarPath', () => {
  it('starts at the baseline and ends at the value', () => {
    const path = roundedBarPath({
      baseline: 0,
      value: 100,
      crossStart: 10,
      thickness: 20,
      orientation: 'horizontal',
    });
    expect(path.startsWith('M 0 10')).toBe(true);
    expect(path).toContain('96');
    expect(path.endsWith('Z')).toBe(true);
  });

  it('rounds toward the tip when the bar grows the other way', () => {
    const path = roundedBarPath({
      baseline: 100,
      value: 20,
      crossStart: 0,
      thickness: 20,
      orientation: 'horizontal',
    });
    expect(path.startsWith('M 100 0')).toBe(true);
    expect(path).toContain('24');
  });

  it('never rounds more than the bar is long or half as thick', () => {
    const stubby = roundedBarPath({
      baseline: 0,
      value: 3,
      crossStart: 0,
      thickness: 20,
      orientation: 'horizontal',
    });
    expect(stubby).toContain('A 3 3');

    const thin = roundedBarPath({ baseline: 0, value: 100, crossStart: 0, thickness: 4, orientation: 'vertical' });
    expect(thin).toContain('A 2 2');
  });

  it('renders nothing for a zero-length bar rather than a stray dot', () => {
    expect(roundedBarPath({ baseline: 50, value: 50, crossStart: 0, thickness: 10, orientation: 'vertical' })).toBe('');
  });
});

describe('barThickness', () => {
  it('caps thickness so a wide band becomes air, not a fat bar', () => {
    expect(barThickness(200)).toBe(24);
  });

  it('always leaves a 2px gap between neighbours', () => {
    expect(barThickness(12)).toBe(10);
  });

  it('never returns a non-positive thickness', () => {
    expect(barThickness(1)).toBe(1);
  });
});

describe('labelFitsInside', () => {
  it('requires padding on both sides', () => {
    expect(labelFitsInside(100, estimateTextWidth('$4.2T'))).toBe(true);
    expect(labelFitsInside(20, estimateTextWidth('$4.2T'))).toBe(false);
  });
});

describe('roundedBarPath, vertical', () => {
  it('brings the rounded corner all the way to the tip', () => {
    // A column growing downward from y=0 to y=100: the first arc must land ON
    // the tip (y=100), not short of it. Landing short leaves a visible notch.
    const path = roundedBarPath({ baseline: 0, value: 100, crossStart: 0, thickness: 20, orientation: 'vertical' });
    expect(path).toContain('A 4 4 0 0 0 4 100');
    expect(path).toContain('L 16 100');
  });

  it('mirrors correctly for a column growing upward', () => {
    const path = roundedBarPath({ baseline: 100, value: 0, crossStart: 0, thickness: 20, orientation: 'vertical' });
    expect(path).toContain('A 4 4 0 0 1 4 0');
    expect(path).toContain('L 16 0');
  });
});
