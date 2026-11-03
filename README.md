# canopy-sdk-js

TypeScript SDK for building apps on [Canopy](https://github.com/slaclab/canopy) — live-PV client, typed API contracts, and the shared Carbon app shell.

Every Canopy web app (react-trace, react-squirrel, the screen system) needs the same three things: a client for Canopy's wire protocols, TypeScript types for its REST/WS contracts, and the standard header/theme. This repo is the single home for those, so they are written once instead of hand-rolled per app.

This is **not** the screen system. The IR renderer and the widget set live in the screen runtime repo, which consumes this SDK exactly like any other client. The Screen IR contract (`@slaclab/canopy-screen-ir`) lives here, because tools that never render a screen (the PyDM converter, CI in screen repos) need it too. The language-neutral IR definition is owned by [canopy-spec](https://github.com/slaclab/canopy-spec); the SDK package follows it (#8).

## Packages

| Package                                           | Contents                                                                                                                                                                                                                                                                                                                                                                                                                         | Framework            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [`@slaclab/canopy-client`](packages/client)       | Hare live PVs (`PVService`/`HarePVService`/`MockPVService`/`LocalPVService`/`RoutedPVService`), Fox formula subscriptions (`FoxFormulaService`), Mole history, background jobs (`getJob`/`awaitJob`), the REST core (`CanopyConnection`/`canopyFetch`/`CanopyError`, FastAPI error normalization), the reconnecting `ResilientSocket` + `toWsUrl`, ns time helpers, typed DTOs; test doubles in `@slaclab/canopy-client/testing` | none — pure TS       |
| [`@slaclab/canopy-react`](packages/react)         | `CanopyProvider`/`useCanopyConnection`, `useCanopyJob`/`useJob` (job status model incl. `unknown`), `usePV`, `PVServiceProvider` — React bindings over `@slaclab/canopy-client`                                                                                                                                                                                                                                                  | React 19             |
| [`@slaclab/canopy-shell`](packages/shell)         | SLAC-branded `AppHeader` (prefix, theme toggle, bug/help actions), g10/g100 color-mode store + `ColorModeTheme`, `AppShell`/`SideNavRail` layout, toasts, confirm dialogs, `ErrorBoundary`                                                                                                                                                                                                                                       | React 19 + Carbon    |
| [`@slaclab/canopy-charts`](packages/charts)       | ECharts helpers: Carbon g10/g100 chart themes, `baseChartOption`, the `CanopyChart` wrapper, PNG capture, categorical palettes, number formatters                                                                                                                                                                                                                                                                                | React 19 + ECharts 6 |
| [`@slaclab/canopy-vite`](packages/vite)           | `canopyDevProxy()` — Vite dev-server proxy for the Canopy API (REST + WebSocket) and elog, injecting the keys server-side                                                                                                                                                                                                                                                                                                        | Node (Vite ^6–^8)    |
| [`@slaclab/canopy-screen-ir`](packages/screen-ir) | The Canopy Screen IR contract: the `*.screen.json` JSON Schema, `SCHEMA_VERSION`, TypeScript model types and `validate()`                                                                                                                                                                                                                                                                                                        | none — pure TS       |

## Ground rules

- **One-way dependency arrow.** trace, squirrel, and the screen system import the SDK; the SDK never imports from any app repo. CI-enforced once packages land.
- **`@slaclab/canopy-client` stays framework-free.** React enters only in `@slaclab/canopy-react`, `@slaclab/canopy-shell` and `@slaclab/canopy-charts`, so Node-side consumers (headless render workers, monitoring scripts, CI) can use the protocol client directly.
- **The screen system stays out.** If a package is only useful when rendering `.screen.json`, it belongs in the screen runtime repo.
- **Language-scoped by design.** A Python SDK would be a sibling (`canopy-sdk-py`), not a tenant here.

## Status

Converted to a pnpm workspace publishing the packages above, each built with `tsc` to `dist/` with type declarations. `HarePVService` is implemented against Hare's `WS /hare/v1/ws/pvs` (subscribe/diff/heartbeat, reconnect with capped backoff + resubscribe; writes via `PUT /hare/v1/pvs/{pv}`). The client also covers the rest of the protocol surface: a REST core (`CanopyConnection` + `canopyFetch` with the `{code, detail}` error envelope), `FoxFormulaService` against Fox's `WS /fox/v1/ws/formulas` (server-assigned subscription ids remapped across reconnects), the Mole history endpoints, job polling (`getJob`/`awaitJob`, plus the `useJob` React hook), and epoch-ns time helpers. All packages share one version (currently 0.2.0), bumped in lockstep.

Packages publish to **npmjs.com** under the `@slaclab` scope. Releasing: bump every package version (and the root) in lockstep on `main`, run `scripts/check-package-tarballs.sh` after `pnpm build`, tag `v<version>`, push the tag — [release.yml](.github/workflows/release.yml) builds, tests, checks the tarballs, and publishes through npm trusted publishing, so the repo holds no npm token. Publish with pnpm, not `npm publish`: only pnpm packs the root `LICENSE.md` and turns `workspace:` ranges into real ones.

## Installing (consumers)

```sh
pnpm add @slaclab/canopy-client
```

No registry setup or token is needed. Packages are on npmjs.com from 0.3.0; earlier versions were on GitHub Packages for internal use only. To move an app over, remove the `@slaclab:registry` line from its `.npmrc`.

## Development

Requires [pnpm](https://pnpm.io/installation).

```sh
pnpm install
```

| Command              | Description                                                                |
| -------------------- | -------------------------------------------------------------------------- |
| `pnpm build`         | Build every package (`tsc` → `dist/` with declarations, topological order) |
| `pnpm test`          | Build, then run every package's tests once                                 |
| `pnpm test:watch`    | Run tests in watch mode across packages                                    |
| `pnpm test:coverage` | Build, then run tests with coverage report                                 |
| `pnpm typecheck`     | Build, then type-check every package including its tests                   |
| `pnpm lint`          | Run ESLint                                                                 |
| `pnpm lint:fix`      | Run ESLint with auto-fix                                                   |
| `pnpm format`        | Format source files with Prettier                                          |
| `pnpm format:check`  | Check formatting without writing                                           |

Single-package variants go through `--filter`, e.g. `pnpm --filter @slaclab/canopy-client test`. Packages that depend on `@slaclab/canopy-client` resolve it via its built `dist/`, so run `pnpm build` after a fresh clone (the root `test`/`typecheck` scripts do this for you).

### Developing an app against a local SDK checkout

[`scripts/link-sdk.pnpmfile.cjs`](scripts/link-sdk.pnpmfile.cjs) points an app's `@slaclab/canopy-*` dependencies at this checkout (`link:`) without changing any file in the app repo. Build the SDK and keep it rebuilding:

```sh
pnpm build:watch
```

Then, in the app, opt in for one shell and install. POSIX shells:

```sh
pnpm_config_pnpmfile=<sdk checkout>/scripts/link-sdk.pnpmfile.cjs pnpm_config_lockfile=false pnpm install
```

PowerShell:

```powershell
$env:pnpm_config_pnpmfile = '<sdk checkout>\scripts\link-sdk.pnpmfile.cjs'
$env:pnpm_config_lockfile = 'false'
pnpm install
```

`lockfile=false` keeps the app's committed `pnpm-lock.yaml` untouched. To go back to the published packages, unset both variables and run `pnpm install` again.

**Dedupe the shared libraries.** A `link:` package resolves its imports from the SDK checkout's own `node_modules`, so without help the app would load a second copy of React, Carbon and ECharts: hooks fail with "Invalid hook call", the shell reads a different Carbon theme context, and `echarts.connect` stops linking charts. Make Vite resolve them from the app:

```ts
// vite.config.ts
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom', '@carbon/react', 'echarts'] },
});
```

## Documentation

The `docs/` directory contains a [Zensical](https://zensical.org) documentation site. To preview it locally:

```sh
uv sync
uv run zensical serve
```

Docs are automatically built and deployed to GitHub Pages on pushes to `main`.

## CI

Three GitHub Actions workflows run on pull requests and pushes to `main`:

- **Lint & Format** — ESLint, Prettier, and TypeScript type-check
- **Test** — Vitest test suite
- **Build & Deploy Documentation** — builds the Zensical docs site and deploys to GitHub Pages

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

canopy-sdk-js is distributed under the terms in [LICENSE.md](LICENSE.md).
