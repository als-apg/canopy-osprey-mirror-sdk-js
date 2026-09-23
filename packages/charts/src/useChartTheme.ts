import { useColorMode } from '@slaclab/canopy-shell';
import { chartThemeFor } from './theme.js';
import type { ChartTheme } from './theme.js';

/**
 * The chart theme for the current color mode of the @slaclab/canopy-shell
 * store. The only helper in this package coupled to the shell; apps with their
 * own color-mode state use `chartThemeFor(mode)` instead.
 */
export function useChartTheme(): Readonly<ChartTheme> {
  const { colorMode } = useColorMode();
  return chartThemeFor(colorMode);
}
