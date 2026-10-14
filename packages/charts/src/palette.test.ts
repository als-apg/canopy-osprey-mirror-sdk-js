import { describe, expect, it } from 'vitest';
import { CARBON_CATEGORICAL, seriesColor } from './palette.js';

describe('CARBON_CATEGORICAL', () => {
  it.each(['light', 'dark'] as const)('%s has 14 distinct hex colors', (mode) => {
    const p = CARBON_CATEGORICAL[mode];
    expect(p).toHaveLength(14);
    expect(new Set(p).size).toBe(14);
    for (const c of p) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("starts with Carbon's purple / cyan / teal / magenta order", () => {
    expect(CARBON_CATEGORICAL.light.slice(0, 4)).toEqual([
      '#6929c4',
      '#1192e8',
      '#005d5d',
      '#9f1853',
    ]);
    expect(CARBON_CATEGORICAL.dark.slice(0, 4)).toEqual([
      '#8a3ffc',
      '#33b1ff',
      '#007d79',
      '#ff7eb6',
    ]);
  });
});

describe('seriesColor', () => {
  it('indexes into the palette for the mode', () => {
    expect(seriesColor(0, 'light')).toBe('#6929c4');
    expect(seriesColor(1, 'dark')).toBe('#33b1ff');
  });

  it('cycles past the end and normalizes negative / fractional / non-finite indexes', () => {
    expect(seriesColor(14, 'light')).toBe(seriesColor(0, 'light'));
    expect(seriesColor(15, 'dark')).toBe(seriesColor(1, 'dark'));
    expect(seriesColor(-1, 'light')).toBe(seriesColor(13, 'light'));
    expect(seriesColor(2.7, 'light')).toBe(seriesColor(2, 'light'));
    expect(seriesColor(Number.NaN, 'dark')).toBe(seriesColor(0, 'dark'));
  });
});
