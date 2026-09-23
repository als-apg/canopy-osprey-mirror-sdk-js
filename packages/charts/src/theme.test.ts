import { describe, expect, it } from 'vitest';
import { CHART_THEMES, baseChartOption, chartAxisStyle, chartThemeFor } from './theme.js';
import type { ChartTheme } from './theme.js';
import { CARBON_CATEGORICAL } from './palette.js';

const KEYS: (keyof ChartTheme)[] = [
  'bg',
  'axisLabel',
  'axisLine',
  'splitLine',
  'axisName',
  'tooltipBg',
  'tooltipBorder',
  'tooltipText',
  'tooltipMuted',
  'crosshair',
  'legend',
];

describe('CHART_THEMES', () => {
  it.each(['light', 'dark'] as const)('%s defines every field as a hex color', (mode) => {
    const t = CHART_THEMES[mode];
    expect(Object.keys(t).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) expect(t[key]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('uses the Carbon g10 / g100 background and text tokens', () => {
    expect(CHART_THEMES.light.bg).toBe('#f4f4f4');
    expect(CHART_THEMES.light.tooltipBg).toBe('#ffffff');
    expect(CHART_THEMES.light.tooltipText).toBe('#161616');
    expect(CHART_THEMES.dark.bg).toBe('#161616');
    expect(CHART_THEMES.dark.tooltipBg).toBe('#262626');
    expect(CHART_THEMES.dark.tooltipText).toBe('#f4f4f4');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CHART_THEMES)).toBe(true);
    expect(Object.isFrozen(CHART_THEMES.dark)).toBe(true);
  });

  it('chartThemeFor is a pure lookup', () => {
    expect(chartThemeFor('light')).toBe(CHART_THEMES.light);
    expect(chartThemeFor('dark')).toBe(CHART_THEMES.dark);
  });
});

describe('baseChartOption', () => {
  const t = CHART_THEMES.dark;

  it('turns animation off and themes background, tooltip and legend', () => {
    const o = baseChartOption(t) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(o.animation).toBe(false);
    expect(o.backgroundColor).toBe(t.bg);
    expect(o.grid).toEqual({ top: 40, bottom: 60, left: 70, right: 20 });
    expect(o.tooltip.backgroundColor).toBe(t.tooltipBg);
    expect(o.tooltip.borderColor).toBe(t.tooltipBorder);
    expect(o.tooltip.textStyle.color).toBe(t.tooltipText);
    expect(o.tooltip.axisPointer.lineStyle.color).toBe(t.crosshair);
    expect(o.legend.textStyle.color).toBe(t.legend);
    expect(o.legend.inactiveColor).toBe(t.tooltipMuted);
    expect(o.color).toBeUndefined();
  });

  it('themes default axes (no axis type, so ECharts defaults apply)', () => {
    const o = baseChartOption(t) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(o.xAxis.type).toBeUndefined();
    expect(o.xAxis.axisLabel.color).toBe(t.axisLabel);
    expect(o.xAxis.splitLine.show).toBe(false);
    expect(o.yAxis.splitLine.lineStyle.color).toBe(t.splitLine);
    expect(o.yAxis.nameTextStyle.color).toBe(t.axisName);
  });

  it('sets the series color cycle when given', () => {
    const o = baseChartOption(t, { colors: CARBON_CATEGORICAL.dark });
    expect(o.color).toEqual([...CARBON_CATEGORICAL.dark]);
    expect(o.color).not.toBe(CARBON_CATEGORICAL.dark);
  });

  it('returns a fresh object each call', () => {
    expect(baseChartOption(t)).not.toBe(baseChartOption(t));
  });
});

describe('chartAxisStyle', () => {
  it('colors labels, lines, ticks, grid and name', () => {
    const t = CHART_THEMES.light;
    expect(chartAxisStyle(t)).toMatchObject({
      axisLabel: { color: t.axisLabel },
      axisLine: { lineStyle: { color: t.axisLine } },
      axisTick: { lineStyle: { color: t.axisLine } },
      splitLine: { lineStyle: { color: t.splitLine } },
      nameTextStyle: { color: t.axisName },
    });
  });
});
