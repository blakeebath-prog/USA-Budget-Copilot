import { describe, expect, it } from 'vitest';
import {
  findField,
  readFirstFiniteNumber,
  readNumber,
  readString,
  requireField,
  SchemaMismatchError,
  toNumber,
} from './fieldResolution';

describe('toNumber', () => {
  it('parses the string amounts Treasury returns', () => {
    expect(toNumber('4200000000')).toBe(4_200_000_000);
    expect(toNumber('1,234,567')).toBe(1_234_567);
    expect(toNumber(-42)).toBe(-42);
  });

  it('reads accounting parentheses as a negative', () => {
    expect(toNumber('(1234)')).toBe(-1234);
  });

  it('treats the feed’s in-band markers as missing, not as zero', () => {
    expect(toNumber('null')).toBeNaN();
    expect(toNumber('(*)')).toBeNaN();
    expect(toNumber('')).toBeNaN();
    expect(toNumber('-')).toBeNaN();
    expect(toNumber(undefined)).toBeNaN();
  });
});

describe('requireField', () => {
  it('returns the first candidate present', () => {
    expect(requireField({ b: 1, c: 2 }, ['a', 'b', 'c'], 'ctx')).toBe('b');
  });

  it('throws a diagnostic naming the columns the feed actually returned', () => {
    let thrown: unknown;
    try {
      requireField({ actual_column: 1 }, ['expected_a', 'expected_b'], 'MTS Table 1 receipts');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchemaMismatchError);
    expect((thrown as Error).message).toContain('MTS Table 1 receipts');
    expect((thrown as Error).message).toContain('expected_a');
    expect((thrown as Error).message).toContain('actual_column');
  });

  it('treats an explicit null as present, since null is a reported value', () => {
    expect(findField({ amount: null }, ['amount'])).toBe('amount');
  });
});

describe('readNumber and readString', () => {
  it('reads through the candidate list', () => {
    expect(readNumber({ fallback_amt: '17' }, ['primary_amt', 'fallback_amt'], 'ctx')).toBe(17);
    expect(readString({ label: 'Total Receipts' }, ['label'], 'ctx')).toBe('Total Receipts');
  });

  it('renders a null string field as empty rather than the text "null"', () => {
    expect(readString({ label: null }, ['label'], 'ctx')).toBe('');
  });
});

describe('readFirstFiniteNumber', () => {
  it('falls through a reported-but-null column to the next candidate', () => {
    // Exactly the MTS shape: detail rows carry gross and a null net.
    const row = { current_fytd_net_rcpt_amt: 'null', current_fytd_gross_rcpt_amt: '1919432792058.01' };
    expect(readFirstFiniteNumber(row, ['current_fytd_net_rcpt_amt', 'current_fytd_gross_rcpt_amt'], 'ctx')).toBe(
      1919432792058.01,
    );
  });

  it('prefers the earlier candidate when it has a real value', () => {
    const row = { net: '10', gross: '12' };
    expect(readFirstFiniteNumber(row, ['net', 'gross'], 'ctx')).toBe(10);
  });

  it('returns NaN when the columns exist but none hold a number', () => {
    expect(readFirstFiniteNumber({ net: 'null', gross: '(*)' }, ['net', 'gross'], 'ctx')).toBeNaN();
  });

  it('throws when no candidate column exists at all', () => {
    expect(() => readFirstFiniteNumber({ other: '1' }, ['net', 'gross'], 'ctx')).toThrow(SchemaMismatchError);
  });
});
