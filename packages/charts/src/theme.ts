import type { EChartsOption } from 'echarts';

export type ChartColorMode = 'light' | 'dark';

/**
 * Colors a chart needs that ECharts doesn't take from the page. ECharts draws
 * on a canvas, so CSS tokens can't reach it: these are resolved Carbon token
 * values, written into the option object (no registered ECharts theme).
 */
export interface ChartTheme {
  /** Chart background — Carbon `background`. */
  bg: string;
  /** Tick labels — `text-secondary`. */
  axisLabel: string;
  /** Axis lines and ticks — `border-strong-01`. */
  axisLine: string;
  /** Grid lines — `layer-accent-01` (a subtle line on `background`). */
  splitLine: string;
  /** Axis titles — `text-helper`. */
  axisName: string;
  /** Tooltip surface — `layer-01`. */
  tooltipBg: string;
  /** Tooltip border — `border-subtle-01`. */
  tooltipBorder: string;
  /** Tooltip body text — `text-primary`. */
  tooltipText: string;
  /** Secondary tooltip text (timestamps, "no data") — `text-helper`. */
  tooltipMuted: string;
  /** Crosshair / axis-pointer lines — `text-helper`. */
  crosshair: string;
  /** Legend text — `text-secondary`. */
  legend: string;
  /** Errors, violations, infeasible points — `support-error`. */
  danger: string;
  /** Success marks — `support-success`. */
  success: string;
  /** Warnings and "best" markers — `support-warning`. */
  warning: string;
  /** The selected point or cursor line — `border-interactive`. */
  selection: string;
  /** Shaded bands behind the data (`markArea`) — `highlight`. */
  highlight: string;
}

/**
 * Carbon g10 (light) and g100 (dark) token values, matching the SLAC standard
 * page themes (`CARBON_THEME` in @slaclab/canopy-shell). Values from
 * @carbon/themes 11.76.
 */
export const CHART_THEMES: Readonly<Record<ChartColorMode, Readonly<ChartTheme>>> = Object.freeze({
  light: Object.freeze({
    bg: '#f4f4f4',
    axisLabel: '#525252',
    axisLine: '#8d8d8d',
    splitLine: '#e0e0e0',
    axisName: '#6f6f6f',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e0e0e0',
    tooltipText: '#161616',
    tooltipMuted: '#6f6f6f',
    crosshair: '#6f6f6f',
    legend: '#525252',
    danger: '#da1e28',
    success: '#24a148',
    warning: '#f1c21b',
    selection: '#0f62fe',
    highlight: '#d0e2ff',
  }),
  dark: Object.freeze({
    bg: '#161616',
    axisLabel: '#c6c6c6',
    axisLine: '#6f6f6f',
    splitLine: '#393939',
    axisName: '#a8a8a8',
    tooltipBg: '#262626',
    tooltipBorder: '#525252',
    tooltipText: '#f4f4f4',
    tooltipMuted: '#a8a8a8',
    crosshair: '#a8a8a8',
    legend: '#c6c6c6',
    danger: '#fa4d56',
    success: '#42be65',
    warning: '#f1c21b',
    selection: '#4589ff',
    highlight: '#001d6c',
  }),
});

/** Pure lookup: the chart theme for a color mode (no dependency on the shell store). */
export function chartThemeFor(mode: ChartColorMode): Readonly<ChartTheme> {
  return CHART_THEMES[mode];
}

const FONT_FAMILY = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * Themed style fragment for one cartesian axis — spread it into each entry of
 * an `xAxis`/`yAxis` array: `yAxis: [{ type: 'value', ...chartAxisStyle(t) }]`.
 */
export function chartAxisStyle(t: Readonly<ChartTheme>) {
  return {
    axisLabel: { color: t.axisLabel, fontFamily: FONT_FAMILY },
    axisLine: { lineStyle: { color: t.axisLine } },
    axisTick: { lineStyle: { color: t.axisLine } },
    splitLine: { lineStyle: { color: t.splitLine } },
    nameTextStyle: { color: t.axisName, fontFamily: FONT_FAMILY },
  };
}

export interface BaseChartOptionConfig {
  /** Series color cycle, e.g. `CARBON_CATEGORICAL[mode]`. Default: ECharts' own. */
  colors?: readonly string[];
}

/**
 * The shared starting point for a chart option: animation off (live data),
 * themed background/text/axes/tooltip/legend, and standard grid insets. Spread
 * it first and override per chart; replace `xAxis`/`yAxis` with your own axes
 * (use `chartAxisStyle` to theme them).
 */
export function baseChartOption(
  t: Readonly<ChartTheme>,
  config: BaseChartOptionConfig = {}
): EChartsOption {
  const axis = chartAxisStyle(t);
  const option: EChartsOption = {
    backgroundColor: t.bg,
    animation: false,
    textStyle: { color: t.tooltipText, fontFamily: FONT_FAMILY },
    grid: { top: 40, bottom: 60, left: 70, right: 20 },
    xAxis: { ...axis, splitLine: { ...axis.splitLine, show: false } },
    yAxis: { ...axis },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: t.tooltipText, fontSize: 12, fontFamily: FONT_FAMILY },
      axisPointer: {
        lineStyle: { color: t.crosshair, width: 1, type: 'dashed' },
        crossStyle: { color: t.crosshair, width: 1, type: 'dashed' },
        label: {
          backgroundColor: t.tooltipBg,
          borderColor: t.tooltipBorder,
          borderWidth: 1,
          color: t.tooltipText,
        },
      },
    },
    legend: {
      textStyle: { color: t.legend, fontFamily: FONT_FAMILY },
      inactiveColor: t.tooltipMuted,
    },
  };
  if (config.colors) option.color = [...config.colors];
  return option;
}
