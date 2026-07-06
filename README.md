# EED SWApps React Template

A template repository for React projects in the EED Software Applications Group at SLAC National Accelerator Laboratory.

## What's included

- **React 19** with **TypeScript**
- **Vite** for fast dev server and builds
- **Vitest** + **React Testing Library** for unit/integration tests
- **ESLint** + **Prettier** + **Husky** pre-commit hooks for consistent code style
- **Zensical** (MkDocs-based) documentation site with GitHub Pages deployment
- GitHub Actions workflows for lint, type-check, test, and docs deployment

## Getting started

### Create a new project from this template

Click **Use this template** on GitHub, or clone and reinitialize:

```sh
git clone https://github.com/slaclab/eed-swapps-react-template.git my-app
cd my-app
git remote remove origin
```

### After cloning, update the project name

1. `package.json` — update `name` and `description`
2. `index.html` — update `<title>`
3. `pyproject.toml` — update `name` and `description`
4. `zensical.toml` — update `site_name`, `site_description`, `repo_name`, `repo_url`, and the social link

### Install dependencies

Requires [pnpm](https://pnpm.io/installation).

```sh
pnpm install
```

## Development

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
