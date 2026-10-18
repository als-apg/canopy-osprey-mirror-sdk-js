// @slaclab/canopy-shell/color-mode: the color-mode store on its own, without
// the Carbon components the root entry pulls in. For packages that only need
// the store (e.g. @slaclab/canopy-charts' useChartTheme). It re-exports the
// same module as the root entry, so both share one store.

export type {
  CarbonColorModeTheme,
  ColorMode,
  ColorModeConfig,
  UseColorModeResult,
} from './themeStore.js';
export {
  CARBON_THEME,
  configureColorMode,
  getColorMode,
  setColorMode,
  syncDocumentColorMode,
  toggleColorMode,
  useColorMode,
} from './themeStore.js';
