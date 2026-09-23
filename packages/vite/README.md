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

The app then talks to the same-origin prefix, and needs no key:

```ts
import { toWsUrl } from '@slaclab/canopy-client';

const connection = { baseUrl: '/api/canopy' }; // REST: /api/canopy/optimization/v1/...
const runsWs = toWsUrl(connection.baseUrl, '/optimization/v1/ws/runs'); // ws(s)://<page host>/api/canopy/...
```

## Options

| Option     | Default                                         | Meaning                                                                                                                              |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `target`   | `CANOPY_BASE_URL`, else `http://localhost:8000` | The Canopy backend. An empty string counts as unset.                                                                                 |
| `apiKey`   | `CANOPY_API_KEY`                                | Sent as `X-API-Key` on proxied requests **and** WebSocket upgrades (`proxyReq` + `proxyReqWs`). Empty or unset: no header is added.  |
| `basePath` | `'/api/canopy'` (when `modules` is not given)   | Single-prefix mode: `${basePath}/*` is forwarded to `${target}/*` with the prefix stripped, with `ws: true`.                         |
| `modules`  | —                                               | Per-module mode (the react-trace/react-squirrel layout): each prefix (`'/hare'`, `'/mole'`, ...) is forwarded unchanged, `ws: true`. |
| `elog`     | off                                             | `{ path?, target?, accessToken? }`: forwards `path` (default `/elog`) to elog-plus with the prefix stripped.                         |

Every Canopy route uses `changeOrigin: true`. `basePath` and `modules` can
be combined. Defaults read `process.env` at call time.

### elog

```ts
canopyDevProxy({
  basePath: '/api/canopy',
  elog: {
    target: env.ELOG_BASE_URL, // default process.env.ELOG_BASE_URL
    accessToken: env.ELOG_API_KEY, // sent as x-vouch-idp-accesstoken
  },
});
```

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
