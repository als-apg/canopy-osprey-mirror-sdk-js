---
icon: lucide/rocket
---

# canopy-sdk-js

The TypeScript SDK for building web apps on
[Canopy](https://github.com/slaclab/canopy): the client for Canopy's wire
protocols, typed API contracts, React bindings, the shared Carbon app
chrome, and dev tooling. Apps such as react-trace, react-squirrel,
react-badger and the screen runtime consume it, so these pieces are written
once instead of per app.

The packages are published in lockstep to GitHub Packages under the
`@slaclab` scope; see the
[repository README](https://github.com/slaclab/canopy-sdk-js#installing-consumers)
for registry setup.

## Protocol client and tooling

- [`@slaclab/canopy-client`](client.md): framework-free protocol client —
  REST core and error handling, the reconnecting `ResilientSocket`, Hare
  live PVs, Fox formulas, Mole history, background jobs, e-log posting, and test doubles
  (`@slaclab/canopy-client/testing`).
- [`@slaclab/canopy-react`](react.md): React bindings — `CanopyProvider`,
  `useCanopyJob`/`useJob`, `useCanopyElogConfig`/`useElogConfig`, `usePV`.
- [`@slaclab/canopy-vite`](vite.md): Vite dev proxy that forwards the Canopy
  API and injects the API key server-side (optionally a separate one for
  e-log).

## UI packages

- [`@slaclab/canopy-shell`](shell.md): the SLAC-branded app chrome —
  `AppHeader`, the g10/g100 color-mode store, `AppShell`/`SideNavRail`
  layout, toasts, confirm dialogs, and `ErrorBoundary`.
- [`@slaclab/canopy-charts`](charts.md): Carbon-themed ECharts helpers —
  chart themes, `baseChartOption`, the `CanopyChart` wrapper, PNG capture,
  categorical palettes, and number formatters.
- `@slaclab/canopy-screen-ir`: the Screen IR contract (`*.screen.json`
  schema, types and `validate()`); see its package in the repository.
