# @slaclab/canopy-vite

Vite dev-server tooling for Canopy apps. `canopyDevProxy()` builds the
`server.proxy` entries every Canopy frontend needs: it forwards the Canopy
API (REST and WebSocket upgrades) to a backend and injects `X-API-Key`
**server-side**, so the key lives in a git-ignored `.env` file and never
reaches the browser bundle. It can also forward elog-plus with its access
token. In production a reverse proxy (nginx) serves the same paths and adds
the same headers.

Node-side only (import it from `vite.config.ts`). Peer dependency: `vite`
(^6, ^7 or ^8).

## Usage

```ts
// vite.config.ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { canopyDevProxy } from '@slaclab/canopy-vite';

export default defineConfig(({ mode }) => {
  // Loading .env files stays the app's job. No VITE_ prefix: these are
  // server-side only.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: canopyDevProxy({
        target: env.CANOPY_BASE_URL, // default http://localhost:8000
        apiKey: env.CANOPY_API_KEY, // X-API-Key on requests + WS upgrades
        basePath: '/api/canopy',
      }),
    },
  };
});
```

```sh
# .env (git-ignored)
CANOPY_BASE_URL=http://localhost:8000
CANOPY_API_KEY=dev
```

The proxy sends this one key to every module it forwards. Canopy keys are
scoped per module, so the key must be scoped `@*` or to each module the app
uses (in the backend's `CANOPY_API_KEYS`, `<token>:<scopes>@<module>+<module>`).
A module outside the key's scope answers 403 `insufficient_module_access`, and
its WebSocket never connects.

The app then talks to the same-origin prefix, and needs no key:

```ts
import { toWsUrl } from '@slaclab/canopy-client';

const connection = { baseUrl: '/api/canopy' }; // REST: /api/canopy/optimization/v1/...
const runsWs = toWsUrl(connection.baseUrl, '/optimization/v1/ws/runs'); // ws(s)://<page host>/api/canopy/...
```

## Options

| Option           | Default                                         | Meaning                                                                                                                              |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `target`         | `CANOPY_BASE_URL`, else `http://localhost:8000` | The Canopy backend. An empty string counts as unset.                                                                                 |
| `apiKey`         | `CANOPY_API_KEY`                                | Sent as `X-API-Key` on proxied requests **and** WebSocket upgrades (`proxyReq` + `proxyReqWs`). Empty or unset: no header is added.  |
| `basePath`       | `'/api/canopy'` (when `modules` is not given)   | Single-prefix mode: `${basePath}/*` is forwarded to `${target}/*` with the prefix stripped, with `ws: true`.                         |
| `modules`        | —                                               | Per-module mode (the react-trace/react-squirrel layout): each prefix (`'/hare'`, `'/mole'`, ...) is forwarded unchanged, `ws: true`. |
| `elog`           | off                                             | `{ path?, target?, accessToken?, accessTokenHeader? }`: forwards `path` (default `/elog`) to elog-plus with the prefix stripped.     |
| `allowedOrigins` | —                                               | Browser origins besides the dev server's own that may use the proxy, e.g. `['http://localhost:6006']` (see [Security](#security)).   |

Every Canopy route uses `changeOrigin: true`. `basePath` and `modules` can
be combined. Defaults read `process.env` at call time.

Each prefix matches only on a path-segment boundary: `/api/canopy` covers
`/api/canopy`, `/api/canopy/...` and `/api/canopy?...`, but not
`/api/canopy-foo`. The returned keys are therefore `^`-anchored RegExp
strings (`'^/api/canopy(?=[/?#]|$)'`), which Vite supports; pass the object
to `server.proxy` as a whole rather than looking entries up by path.

### elog

```ts
canopyDevProxy({
  basePath: '/api/canopy',
  elog: {
    target: env.ELOG_BASE_URL, // default process.env.ELOG_BASE_URL
    accessToken: env.ELOG_API_KEY, // default process.env.ELOG_API_KEY
  },
});
```

The token is sent in `x-vouch-idp-accesstoken`, the header elog-plus reads
behind Vouch Proxy. If your elog-plus sits behind a different auth proxy, set
`accessTokenHeader` (or `ELOG_TOKEN_HEADER`) to the header it expects.

When no elog target is set (neither `elog.target` nor `ELOG_BASE_URL`), the
elog route is left out, so the app can hide its logbook features.

### Migrating react-trace / react-squirrel

Their hand-written blocks map to:

```ts
// react-trace: /mole, /hare, /fox (+ /elog), same-origin baseUrl ''
canopyDevProxy({
  target: env.CANOPY_BASE_URL,
  apiKey: env.CANOPY_API_KEY,
  modules: ['/mole', '/hare', '/fox'],
  elog: { target: env.ELOG_BASE_URL, accessToken: env.ELOG_API_KEY },
});
```

## Security

The proxy adds credentials, so it serves only the app's own page and
non-browser tools. Without that, any website open in the developer's browser
could call `http://localhost:5173/api/canopy/...`, or open a WebSocket (which
has no CORS), and have the key added for it.

- **Cross-origin requests are refused.** A request whose `Origin` does not
  match the dev server's host and port (the `Host` header), or that has
  `Sec-Fetch-Site: cross-site` or `same-site`, is answered `403` and never
  forwarded; a WebSocket handshake is refused (Vite answers `404`).
  `same-site` covers pages on another port of `localhost`, which browsers
  count as the same site. Same-origin requests from the app, and clients
  that send no `Origin` (curl, scripts, tests), pass. List other trusted
  origins, such as a Storybook on another port, in `allowedOrigins`; that
  admits their `fetch` and WebSocket calls (which carry an `Origin`), not
  `<img>`-style requests without one.
- **Cookies are dropped.** The `Cookie` header is removed before forwarding,
  so `localhost` cookies from other apps never reach the target.
- **Keep Vite's host check.** DNS rebinding (a hostile name resolving to
  your machine, so its `Origin` and `Host` agree) is blocked by Vite's
  `server.allowedHosts` (Vite 6.0.9 and later); don't set it to `true`. With `server.host`
  (listening on the LAN) anyone who can reach the port can use the key, as
  with any dev proxy; prefer a key with limited rights.
