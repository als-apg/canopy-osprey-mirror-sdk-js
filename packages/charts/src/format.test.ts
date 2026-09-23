import { describe, expect, it } from 'vitest';
import { formatAxisTick, formatValue } from './format.js';

describe('formatAxisTick (react-trace)', () => {
  it.each([
    [0, '0'],
    [12.5, '12.5'],
    [-3, '-3'],
    [0.001, '0.001'],
    [999999, '999999'],
    [0.0005, '5.0e-4'],
    [-0.0001, '-1.0e-4'],
    [0.000000018, '1.8e-8'],
    [1_000_000, '1.0e+6'],
    [1234567, '1.2e+6'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
  ])('%s → %s', (v, expected) => {
    expect(formatAxisTick(v)).toBe(expected);
  });
});

describe('formatValue', () => {
  it.each([
    [0, '0'],
    [0.5, '0.5'],
    [1 / 3, '0.3333333'],
    [-2.25, '-2.25'],
    [123456.789, '123456.8'],
    [9999999, '9999999'],
    [1e7, '1e+7'],
    [12345678, '1.234568e+7'],
    [0.001, '0.001'],
    [0.00099, '9.9e-4'],
    [1.5e-5, '1.5e-5'],
    [-1e-4, '-1e-4'],
  ])('%s → %s', (v, expected) => {
    expect(formatValue(v)).toBe(expected);
  });

  it('honours the digits argument', () => {
    expect(formatValue(Math.PI, 3)).toBe('3.14');
    expect(formatValue(1.23456e-6, 3)).toBe('1.23e-6');
    expect(formatValue(Math.PI, 0)).toBe('3');
  });

  it('stringifies non-numbers and renders null/undefined as empty', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue(undefined)).toBe('');
    expect(formatValue('x0')).toBe('x0');
    expect(formatValue(true)).toBe('true');
    expect(formatValue(Number.NaN)).toBe('NaN');
    expect(formatValue(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
  });
});
