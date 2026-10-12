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

## Host theme contract v1

An app built on this shell can be embedded in a host page (a dashboard, a web
terminal) and take the host's fonts, colours, radii and control heights instead
of Carbon's. The host fills `--canopy-host-*` custom properties on one anchor
element per document; the app reads only those names and never the host's own.
The items below are the whole interface. An app gains nothing else from being
embedded, and a host needs to know nothing else about the app.

### Standalone guarantee

Without a host stylesheet nothing changes: every `--canopy-*` variable computes
to the Carbon value of its zone, so the app renders with Carbon defaults. The
same holds when a host stylesheet is named but fails to load (see
`applyHostSheetFallback`), and for each single name a host leaves unset, because
every read of a `--canopy-host-*` property carries the Carbon value as its
fallback.

### Versioning

A host stylesheet declares the contract version it was written for as
`--canopy-host-contract: 1` on the anchor. A 1.x release of the contract adds
names with fallbacks only, so a host written for 1.0 keeps working; renaming or
removing a name is version 2. `useHostTheme` warns once in the console when the
declared version is missing or has a different major, and applies the theme
either way.

### The names

Contract v1 has 27 names, each set by the host as `--canopy-host-<name>` and
read by the app as `--canopy-<name>`:

| Group    | Names                                                              |
| -------- | ------------------------------------------------------------------ |
| Fonts    | `font-ui`, `font-mono`                                             |
| Sizes    | `text-sm`, `text-md`, `text-lg`                                    |
| Radii    | `radius-sm`, `radius-md`                                           |
| Controls | `control-h-xs`, `control-h-sm`                                     |
| Surfaces | `bg-base`, `bg-panel`, `bg-elevated`, `bg-field`                   |
| Text     | `text-primary`, `text-secondary`, `text-muted`                     |
| Borders  | `border`, `border-strong`                                          |
| Accent   | `accent`, `on-accent`, `accent-hover`, `accent-tint`, `hover-tint` |
| Focus    | `focus`                                                            |
| Status   | `status-success`, `status-warning`, `status-error`                 |

### What the server that delivers the page does

- **The sidecar setting.** The server that serves the app names the host's
  stylesheets in one setting (`CANOPY_HOST_STYLESHEETS` in `canopy_mcp`:
  whitespace-separated relative `.css` paths); there is no URL parameter for
  it, so nothing a page visitor controls reaches the list.
- **`data-canopy-host` on `<html>`.** The gate: every host-driven rule of
  `host-contract.css` is scoped under `html[data-canopy-host]`, so a document
  without the attribute is standalone.
- **`data-canopy-host-sheet` on each `<link>`.** The marker that tells the app
  which stylesheets are the host's, so it can check that each one loaded.

### What the app puts on its root element

`useHostTheme` returns all three as `anchorProps`; they go on the one element
the host stylesheet styles.

- **`data-canopy-host-root`.** Marks the anchor: the element on which the host
  sets its `--canopy-host-*` properties and which fills the viewport with the
  host's base background.
- **`data-floating-menu-container`.** Makes Carbon render menus, tooltips and
  other floating layers inside the anchor, so they inherit its properties
  instead of landing on `<body>` outside them.
- **`data-theme`.** Carries the validated theme id, which is what a host
  stylesheet selects on to tell its themes apart.

### Files

```ts
import '@slaclab/canopy-shell/host-contract.css';
import tokens from '@slaclab/canopy-shell/tokens.json' with { type: 'json' };
import wiring from '@slaclab/canopy-shell/wiring.json' with { type: 'json' };
```

- **`host-contract.css`.** The stylesheet an app imports after Carbon's: it
  defines every `--canopy-*` variable per Carbon zone, points Carbon's own
  tokens at them, and holds the few component rules that read them.
- **`tokens.json`.** The contract as data: the version, the four Carbon zones
  and, for each of the 27 names, its Carbon value per zone and the Carbon
  tokens it drives.
- **`wiring.json`.** The map from every Carbon zone, type and layout token to
  the contract name that drives it, or to the reason it stays Carbon's.
- **`fixtures/host/*`.** Shared test data and setups (a sample host stylesheet
  and its values, the probe rows, the page setups, the expected `<link>` tail),
  exported as `./fixtures/*` so every consuming repository tests against the
  same host.

`host-contract.css`, `tokens.json` and `wiring.json` are generated from the
pinned `@carbon/styles` by `pnpm run gen-tokens`; `pnpm test` fails when they
are stale.

### Helpers

All are exported from the package root.

- **`applyHostSheetFallback(doc?)`.** Removes `data-canopy-host` and warns once
  when a marked host stylesheet is missing or empty, so a 404 leaves the app in
  its standalone look instead of half-styled; call it after the document's
  `load`.
- **`useHostTheme(raw, mode)`.** Validates the theme id the host asked for,
  falls back to the app's colour mode, and returns the `id`, an `anchorRef`
  and the `anchorProps` for the root element.
- **`useChartFont(ref)`.** Returns the font family a chart's wrapper element
  computes and whether it has loaded, because canvas text does not inherit CSS.
- **`useFontsReady(family, doc)`.** Turns true once a font family has finished
  loading in a document, which is when a canvas chart should redraw.
- **`modeFromThemeId(id)`.** Maps a theme id to a colour mode: `light` and
  every `*-light` id are light, everything else is dark.
- **`HOST_THEME_ID`.** The regular expression a theme id must match
  (`/^[a-z0-9][a-z0-9-]{0,39}$/`); an id that fails it never reaches the DOM.
- **`.canopy-btn`.** The class of the shell's ghost button, defined in
  `host-contract.css`: transparent at rest, an alpha accent border on hover and
  when pressed.

```tsx
import { useColorMode, useHostTheme } from '@slaclab/canopy-shell';

function AppRoot({ hostThemeId }: { hostThemeId: string | null }) {
  const { colorMode } = useColorMode();
  const { anchorRef, anchorProps } = useHostTheme<HTMLDivElement>(hostThemeId, colorMode);

  return (
    <div ref={anchorRef} {...anchorProps}>
      {/* ...the app... */}
    </div>
  );
}
```

### Messages

- **`theme` on `canopy:trace-theme`.** The message an embedding viewer posts to
  an embedded Trace frame is `{ mode, theme }`: `mode` is `light` or `dark`,
  and `theme` is the validated host theme id, which the receiver passes to
  `useHostTheme`.
