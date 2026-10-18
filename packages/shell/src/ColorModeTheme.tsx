import type { HTMLAttributes, ReactNode } from 'react';
import { Theme } from '@carbon/react';
import { useColorMode } from './themeStore.js';

export interface ColorModeThemeProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * The one-liner app root: a Carbon `<Theme>` set to `CARBON_THEME[colorMode]`
 * (g10 light / g100 dark) that follows the SDK color-mode store, and keeps
 * `<html>` in sync (`data-theme` + `cds--g10`/`cds--g100`) for portaled content.
 */
export function ColorModeTheme({ children, ...rest }: ColorModeThemeProps) {
  const { carbonTheme } = useColorMode();
  return (
    <Theme theme={carbonTheme} {...rest}>
      {children}
    </Theme>
  );
}
