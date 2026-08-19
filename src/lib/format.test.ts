import { describe, expect, it } from 'vitest';
import {
  compactNumber,
  compactUsd,
  dayLabel,
  deltaDirection,
  fullUsd,
  monthLabel,
  percent,
  signedPercent,
} from './format';

describe('compactUsd', () => {
  it('scales into trillions, billions, millions, and thousands', () => {
    expect(compactUsd(6_750_000_000_000)).toBe('$6.8T');
    expect(compactUsd(4_200_000_000)).toBe('$4.2B');
    expect(compactUsd(1_500_000)).toBe('$1.5M');
    expect(compactUsd(2_400)).toBe('$2.4K');
    expect(compactUsd(940)).toBe('$940');
  });

  it('keeps the sign outside the dollar symbol', () => {
    expect(compactUsd(-1_800_000_000)).toBe('-$1.8B');
  });

  it('drops the decimal once three digits are showing', () => {
    expect(compactUsd(125_000_000_000)).toBe('$125B');
  });

  it('does not write a trailing .0, which reads as false precision', () => {
    expect(compactUsd(91_000_000_000)).toBe('$91B');
    expect(compactUsd(20_000_000_000_000)).toBe('$20T');
    expect(compactNumber(3_000_000)).toBe('3M');
  });

  it('renders a non-finite value as an em dash rather than NaN', () => {
    expect(compactUsd(Number.NaN)).toBe('—');
    expect(compactUsd(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('fullUsd', () => {
  it('writes the whole number with separators and no cents', () => {
    expect(fullUsd(1_234_567)).toBe('$1,234,567');
  });
});

describe('compactNumber', () => {
  it('omits the currency symbol', () => {
    expect(compactNumber(2_500_000)).toBe('2.5M');
  });
});

describe('percent and signedPercent', () => {
  it('formats a ratio', () => {
    expect(percent(0.2137)).toBe('21.4%');
  });

  it('signs only positive change', () => {
    expect(signedPercent(0.081)).toBe('+8.1%');
    expect(signedPercent(-0.081)).toBe('-8.1%');
  });
});

describe('date labels', () => {
  it('reads an ISO date as a plain date, with no timezone shift', () => {
    expect(monthLabel('2026-01-31')).toBe('Jan 2026');
    expect(dayLabel('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('passes through anything that is not an ISO date', () => {
    expect(monthLabel('unknown')).toBe('unknown');
  });
});

describe('deltaDirection', () => {
  it('calls a rounding-level wobble flat rather than a move', () => {
    expect(deltaDirection(0)).toBe('flat');
    expect(deltaDirection(0.0001)).toBe('flat');
    expect(deltaDirection(Number.NaN)).toBe('flat');
  });

  it('signs a real change', () => {
    expect(deltaDirection(0.08)).toBe('up');
    expect(deltaDirection(-0.08)).toBe('down');
  });
});
