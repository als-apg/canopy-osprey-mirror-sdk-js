# @slaclab/canopy-vite

Dev-server tooling for Canopy apps built with Vite. `canopyDevProxy()`
returns the `server.proxy` entries that forward the Canopy API (REST and
WebSockets) to a backend and inject the API key on the server side, so the
key stays in a git-ignored `.env` and never reaches the browser bundle.
Peer dependency: `vite` ^6, ^7 or ^8.

The full reference is the
[package README](https://github.com/slaclab/canopy-sdk-js/tree/main/packages/vite).

## Setup

```ts
// vite.config.ts
import { defineConfig, loadEnv } from 'vite';
import { canopyDevProxy } from '@slaclab/canopy-vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: {
      proxy: canopyDevProxy({
        target: env.CANOPY_BASE_URL, // default http://localhost:8000
        apiKey: env.CANOPY_API_KEY,
        basePath: '/api/canopy',
      }),
    },
  };
});
```

```sh
# .env — server-side only (no VITE_ prefix)
CANOPY_BASE_URL=http://localhost:8000
CANOPY_API_KEY=dev
```

The app uses the same relative prefix a production reverse proxy would
serve, and no key:

```ts
const connection = { baseUrl: '/api/canopy' };
const wsUrl = toWsUrl(connection.baseUrl, '/optimization/v1/ws/runs'); // from @slaclab/canopy-client
```

## What it generates

- **`basePath` mode** (default `/api/canopy`): `${basePath}/*` is forwarded
  to `${target}/*` with the prefix stripped, with `changeOrigin` and
  `ws: true`.
- **`modules` mode**: `modules: ['/hare', '/mole', '/formula-engine']` forwards each
  prefix unchanged (the react-trace / react-squirrel layout, with a
  same-origin `baseUrl: ''`). It can be combined with `basePath`.
- **API key**: `X-API-Key` is set on proxied requests and on WebSocket
  upgrades, and only when a key is configured (`apiKey`, else
  `CANOPY_API_KEY`). The same key goes to every proxied module, so with
  Canopy's module-scoped keys it must be scoped `@*` or to each module the
  app uses (in `CANOPY_API_KEYS`, `<token>:<scopes>@<module>+<module>`);
  otherwise those modules answer 403 `insufficient_module_access`.
- **E-log key** (optional): Canopy's e-log module (`/elog`) is proxied like
  any other module (list `'/elog'` in `modules`; under `basePath` it already
  is). `elogApiKey` (else `CANOPY_ELOG_API_KEY`) sends it a key of its own,
  such as a `read+write@elog` key, so that `apiKey` can stay read-only
  (Canopy's `read`/`write` scopes are per key). Unset or empty, e-log gets
  `apiKey`.
- **elog** (deprecated, removed in 0.4): the direct elog-plus proxy
  (`elog: { target, accessToken, path, accessTokenHeader }`). Canopy's e-log
  module holds the e-log token server-side, so drop it; its path may no
  longer overlap a Canopy route.

## Security

The proxy adds the key, so it only serves the app's own page and non-browser
tools:

- a request whose `Origin` is not the dev server's own host and port, or that
  has `Sec-Fetch-Site: cross-site` or `same-site` (a page on another
  `localhost` port), is refused (`403`; a WebSocket handshake gets `404`) and
  never forwarded. Clients without an `Origin` (curl, scripts) pass, and
  `allowedOrigins: ['http://localhost:6006']` admits other trusted pages'
  `fetch` and WebSocket calls;
- prefixes match on a path-segment boundary (`/api/canopy-foo` is not
  proxied), so the returned keys are `^`-anchored RegExp strings;
- the `Cookie` header is dropped before forwarding.

Keep Vite's `server.allowedHosts` check on: it is what stops DNS rebinding.
