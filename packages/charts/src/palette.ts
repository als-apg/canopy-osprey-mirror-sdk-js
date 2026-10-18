import type { ChartColorMode } from './theme.js';

/**
 * Carbon's 14-color categorical data-visualization palettes, in Carbon's
 * order: light themes (white/g10) and dark themes (g90/g100). Resolved from
 * @carbon/colors 11.53 the way @carbon/charts builds them (palette "14", option
 * 1), so three entries differ from the older values on the Carbon website
 * (red-90 #520408 vs #570408, magenta-50 #ee5396 vs #ee538b, magenta-60
 * #d02670 vs #d12771).
 */
export const CARBON_CATEGORICAL: Readonly<Record<ChartColorMode, readonly string[]>> =
  Object.freeze({
    light: Object.freeze([
      '#6929c4', // purple 70
      '#1192e8', // cyan 50
      '#005d5d', // teal 70
      '#9f1853', // magenta 70
      '#fa4d56', // red 50
      '#520408', // red 90
      '#198038', // green 60
      '#002d9c', // blue 80
      '#ee5396', // magenta 50
      '#b28600', // yellow 50
      '#009d9a', // teal 50
      '#012749', // cyan 90
      '#8a3800', // orange 70
      '#a56eff', // purple 50
    ]),
    dark: Object.freeze([
      '#8a3ffc', // purple 60
      '#33b1ff', // cyan 40
      '#007d79', // teal 60
      '#ff7eb6', // magenta 40
      '#fa4d56', // red 50
      '#fff1f1', // red 10
      '#6fdc8c', // green 30
      '#4589ff', // blue 50
      '#d02670', // magenta 60
      '#d2a106', // yellow 40
      '#08bdba', // teal 40
      '#bae6ff', // cyan 20
      '#ba4e00', // orange 60
      '#d4bbff', // purple 30
    ]),
  });

/** Color for the i-th series (cycling; negative and fractional indexes are normalized). */
export function seriesColor(i: number, mode: ChartColorMode): string {
  const palette = CARBON_CATEGORICAL[mode];
  const n = palette.length;
  const idx = Number.isFinite(i) ? Math.trunc(i) : 0;
  return palette[((idx % n) + n) % n];
}
