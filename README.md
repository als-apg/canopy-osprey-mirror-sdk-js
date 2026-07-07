# canopy-sdk-js

TypeScript SDK for building apps on [Canopy](https://github.com/slaclab/canopy) — live-PV client, typed API contracts, and the shared Carbon app shell.

Every Canopy web app (react-trace, react-squirrel, the screen system) needs the same three things: a client for Canopy's wire protocols, TypeScript types for its REST/WS contracts, and the standard header/theme. This repo is the single home for those, so they are written once instead of hand-rolled per app.

This is **not** the screen system. `screen-ir`, the IR renderer, and the widget set live in the screen runtime repo, which consumes this SDK exactly like any other client.

## Packages (planned)

| Package | Contents | Framework |
|---|---|---|
| `@canopy/client` | `PVService` interface, `HarePVService` (live-PV WS: subscribe/unsubscribe/diff/heartbeat, reconnect + resubscribe), `MockPVService`, typed DTOs for Canopy's REST/WS APIs | none — pure TS |
| `@canopy/react` | `usePV`, `PVContext` — React bindings over `@canopy/client` | React 19 |
| `@canopy/shell` | `<AppHeader title toolbar>` + theme store — the standard Carbon chrome | React 19 + Carbon |

Porting sources: `PVService`/`MockPVService` and `usePV` from `canopy-screen-builder`; the header/theme from `react-trace` (the donor app — its own adoption back should be a near-noop); `HarePVService` written new against Hare's `WS /hare/v1/ws/pvs`.

## Ground rules

- **One-way dependency arrow.** trace, squirrel, and the screen system import the SDK; the SDK never imports from any app repo. CI-enforced once packages land.
- **`@canopy/client` stays framework-free.** React enters only in `@canopy/react` and `@canopy/shell`, so Node-side consumers (headless render workers, monitoring scripts, CI) can use the protocol client directly.
- **The screen system stays out.** If a package is only useful when rendering `.screen.json`, it belongs in the screen runtime repo.
- **Language-scoped by design.** A Python SDK would be a sibling (`canopy-sdk-python`), not a tenant here.

## Status

Freshly instantiated from the EED React template — still a single-app scaffold. First change: convert to a pnpm workspace (`packages/client`, `packages/react`, `packages/shell`) and port the sources above.

## Development

Requires [pnpm](https://pnpm.io/installation).

```sh
pnpm install
```

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server at `http://localhost:5173` |
| `pnpm build` | Type-check and build for production |
| `pnpm preview` | Preview production build locally |
| `pnpm test` | Run tests once |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Run ESLint with auto-fix |
| `pnpm format` | Format source files with Prettier |
| `pnpm format:check` | Check formatting without writing |

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
