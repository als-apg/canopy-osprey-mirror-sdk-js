# @slaclab/canopy-shell

The standard Canopy app chrome: a Carbon `<AppHeader>` (a dark g100 brand bar
that stays dark even when the rest of the app is in light mode) plus a
light/dark theme store (`useColorMode`) that apps wire up to their own
theme-toggle button.

## Install

Peer dependencies (install alongside this package): `react`, `react-dom`,
`@carbon/react`, `@carbon/icons-react`.

## Usage

```tsx
import '@carbon/styles/css/styles.css';
import '@slaclab/canopy-shell/styles.css';
import { Theme, HeaderGlobalAction } from '@carbon/react';
import { Asleep, Light } from '@carbon/icons-react';
import { AppHeader, useColorMode } from '@slaclab/canopy-shell';

function AppRoot() {
  const { colorMode, toggle } = useColorMode();

  return (
    <Theme theme={colorMode === 'dark' ? 'g90' : 'g10'}>
      <AppHeader
        title="MYAPP"
        toolbar={
          <HeaderGlobalAction aria-label="Toggle theme" onClick={toggle} tooltipAlignment="end">
            {colorMode === 'dark' ? <Light size={20} /> : <Asleep size={20} />}
          </HeaderGlobalAction>
        }
      />
      {/* ...rest of the app... */}
    </Theme>
  );
}
```

`AppHeader` always renders inside its own `<Theme theme="g100">` wrap, so the
brand bar stays a dark header even when the app body is switched to light
mode — this is the react-trace/react-squirrel convention. Apps only need to
theme the body of the page; the header takes care of itself.

`toggleColorMode()` (or the `toggle` returned from `useColorMode()`) is the
helper apps call from their own toolbar button to flip between light and
dark — `AppHeader` does not render a theme toggle itself, so it must be
supplied via the `toolbar` prop as shown above.

`children` is an optional slot rendered between the product name and the
global bar, for things like status text or counts.
