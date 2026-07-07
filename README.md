# canopy-sdk-js

TypeScript SDK for building apps on [Canopy](https://github.com/slaclab/canopy) — live-PV client, typed API contracts, and the shared Carbon app shell.

Every Canopy web app (react-trace, react-squirrel, the screen system) needs the same three things: a client for Canopy's wire protocols, TypeScript types for its REST/WS contracts, and the standard header/theme. This repo is the single home for those, so they are written once instead of hand-rolled per app.

This is **not** the screen system. `screen-ir`, the IR renderer, and the widget set live in the screen runtime repo, which consumes this SDK exactly like any other client.

## Packages

| Package                             | Contents                                                                                                                                                                  | Framework         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| [`@canopy/client`](packages/client) | `PVService` interface, `HarePVService` (live-PV WS: subscribe/unsubscribe/diff/heartbeat, reconnect + resubscribe), `MockPVService`, typed DTOs for Canopy's REST/WS APIs | none — pure TS    |
| [`@canopy/react`](packages/react)   | `usePV`, `PVServiceProvider` — React bindings over `@canopy/client`                                                                                                       | React 19          |
| [`@canopy/shell`](packages/shell)   | `<AppHeader title toolbar>` + theme store — the standard Carbon chrome                                                                                                    | React 19 + Carbon |

Porting sources: `PVService`/`MockPVService` and `usePV` from `canopy-screen-builder`; the header/theme from `react-trace` (the donor app — its own adoption back should be a near-noop); `HarePVService` written new against Hare's `WS /hare/v1/ws/pvs`.

## Ground rules

- **One-way dependency arrow.** trace, squirrel, and the screen system import the SDK; the SDK never imports from any app repo. CI-enforced once packages land.
- **`@canopy/client` stays framework-free.** React enters only in `@canopy/react` and `@canopy/shell`, so Node-side consumers (headless render workers, monitoring scripts, CI) can use the protocol client directly.
- **The screen system stays out.** If a package is only useful when rendering `.screen.json`, it belongs in the screen runtime repo.
- **Language-scoped by design.** A Python SDK would be a sibling (`canopy-sdk-python`), not a tenant here.

## Status

Converted to a pnpm workspace publishing the three packages above, each built with `tsc` to `dist/` with type declarations. `PVService`/`MockPVService` and `usePV` are ported from `canopy-screen-builder`, the header/theme shell from `react-trace`, and `HarePVService` is implemented against Hare's `WS /hare/v1/ws/pvs` (subscribe/diff/heartbeat, reconnect with capped backoff + resubscribe; writes via `PUT /hare/v1/pvs/{pv}`). All packages are version 0.1.0; the publish target (registry) is not decided yet, so nothing is published.

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

Single-package variants go through `--filter`, e.g. `pnpm --filter @canopy/client test`. Packages that depend on `@canopy/client` resolve it via its built `dist/`, so run `pnpm build` after a fresh clone (the root `test`/`typecheck` scripts do this for you).

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
