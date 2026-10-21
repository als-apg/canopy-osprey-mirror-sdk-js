# @slaclab/canopy-client

The framework-free protocol client: everything needed to talk to a Canopy
deployment from a browser, Node, or a test, with no React, DOM lib, or
`@types/node` dependency.

| Area            | Exports                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| REST core       | `CanopyConnection`, `canopyFetch`, `CanopyError`, `ValidationIssue`                  |
| Streams         | `ResilientSocket`, `toWsUrl`, `SocketStatus`                                         |
| Live PVs (Hare) | `HarePVService`, `PVService`, `MockPVService`, `LocalPVService`, `RoutedPVService`   |
| Formulas (Fox)  | `FoxFormulaService`, `FormulaSpec`                                                   |
| History (Mole)  | `fetchData`, `fetchMetadata`, `searchPVs`, `listArchivers`                           |
| Background jobs | `getJob`, `awaitJob`, `JobFailedError`, `isJobNotFoundError`                         |
| E-log           | `getElogConfig`, `listElogLogbooks`, `uploadElogAttachment`, `createElogEntry`, ...  |
| Time            | `nowNs`, `msToNs`, `nsToMs`, `dateToNs`, `nsToDate`                                  |
| Test doubles    | `@slaclab/canopy-client/testing`: `createFakeFetch`, `jsonResponse`, `FakeWebSocket` |

The full reference is the
[package README](https://github.com/slaclab/canopy-sdk-js/tree/main/packages/client).

## Connecting

Every REST helper takes a `CanopyConnection`:

```ts
import type { CanopyConnection } from '@slaclab/canopy-client';

// Directly against a deployment (the SDK sends X-API-Key itself):
const direct: CanopyConnection = { baseUrl: 'https://canopy.example.org', apiKey: 'my-key' };

// Behind a same-origin proxy that injects the key (dev: @slaclab/canopy-vite, prod: nginx):
const proxied: CanopyConnection = { baseUrl: '/api/canopy' };
```

`canopyFetch<T>(conn, path, { method?, query?, body?, signal? })` sends
JSON bodies, passes `FormData` bodies through untouched (multipart),
repeats the query key for an array value, and resolves an empty 2xx body
to `undefined`.

## Errors

Every failure is a `CanopyError` with `code`, `status` (0 without a
response) and a string `detail`. Besides Canopy's own `{code, detail}`
envelope, FastAPI's bodies are normalized:

- `422 {"detail": [{loc, msg, type}, ...]}` becomes `validation_error`, with
  the entries on `error.issues` and a readable `detail` such as
  `body.variables[0].lower: Value error, lower > upper`.
- `{"detail": "Not Found"}` without a code becomes `not_found` (404) or
  `http_error`.
- A non-JSON body gives `unknown_error`; no response gives `network_error`.
- Aborts are rethrown unchanged (`AbortError`).

The API-key checks every module shares are typed as `CanopyAuthErrorCode`
(401 `invalid_api_key`, 403 `insufficient_module_access`, 403
`insufficient_{read,write,admin}_access`).

## Streams

`ResilientSocket` is the reconnecting JSON WebSocket under `HarePVService`
and `FoxFormulaService`; use it for any other Canopy stream:

```ts
import { ResilientSocket, toWsUrl } from '@slaclab/canopy-client';

const socket = new ResilientSocket({
  url: toWsUrl('/api/canopy', '/optimization/v1/ws/runs'),
  jitterMs: 250,
  onOpen: (send) => resubscribeEverything(send), // every (re)connect
  onFrame: (frame) => dispatch(frame), // parsed JSON objects
  onClose: () => forgetPendingReplies(), // per-socket state
  onStatusChange: (status) => showConnection(status),
});
socket.connect();
```

- Capped backoff reconnect (`[1000, 2000, 4000, 8000, 15000]` ms) with
  optional jitter; `connect()` is idempotent.
- `{"type":"ping"}` every 15 s; a socket silent for 10 s after a ping is
  dropped and reconnected.
- Close codes in `terminalCloseCodes` (default `[1008]`) stop the loop
  (status `closed`, `onError` with `ws_terminal_close`). Browsers only ever
  report a rejected handshake as 1006, so browser apps detect a bad key
  through REST instead: 401 `invalid_api_key`, or 403
  `insufficient_module_access` for a key not scoped to the module, probed on
  the module the socket uses.
- `toWsUrl` maps `http(s)` to `ws(s)` and resolves relative bases against
  the page location.

## Background jobs

```ts
import { awaitJob, JobFailedError } from '@slaclab/canopy-client';

const done = await awaitJob(conn, jobId, {
  pollMs: 1000,
  timeoutMs: 10 * 60_000,
});
```

Canopy answers `404 job_not_found` for an id it has no record of: a
mistyped or foreign id, or a job whose result expired (after the worker's
`keep_result_s`, one hour by default). A job still queued, on any worker
queue, reports `pending`. `awaitJob` rejects on that 404 by default;
`notFoundGraceMs` keeps polling through it (useful against older backends,
which answered 404 while a job was queued on a non-default queue). React
apps get the same model from [`useCanopyJob`](react.md).

## E-log

Canopy's e-log module posts to the e-log backend with one token per client
app, held server-side. Each per-app call names the app (`'trace'`,
`'squirrel'`, ...); the API key needs the `elog` scope (`write` to post).

```ts
import { createElogEntry, getElogConfig, uploadElogAttachment } from '@slaclab/canopy-client';

const config = await getElogConfig(conn, 'trace'); // { enabled, defaultLogbookIds, reason, ... }
if (config.enabled) {
  const { id } = await uploadElogAttachment(conn, 'trace', pngBlob, { filename: 'plot.png' });
  await createElogEntry(conn, 'trace', {
    logbookIds: config.defaultLogbookIds,
    title: 'Orbit drift',
    bodyMarkdown: 'BPM readings drifted.',
    attachmentIds: [id],
  });
}
```

Also `listElogLogbooks`, `listElogTags`, `searchElogUsers`,
`listElogRecentEntries`, `getElogHealthSummary` and `getElogWatchdog`.
Failures are `CanopyError`s; `isElogError(err, code?)` matches the module's
codes (`elog_not_configured`, `elog_upstream_error`,
`elog_attachment_too_large`, ...). Empty-string ids are a 422
`validation_error`. React apps can use [`useElogConfig`](react.md).

## Testing

`@slaclab/canopy-client/testing` is a separate entry point with
framework-free doubles:

```ts
import {
  createFakeFetch,
  createFakeWebSocketFactory,
  jsonResponse,
} from '@slaclab/canopy-client/testing';

const fetch = createFakeFetch({
  'GET /jobs/v1/:id': [jsonResponse(pending), jsonResponse(done)], // one per call
  'POST /optimization/v1/runs': (req) => jsonResponse({ id: 'r1' }, { status: 201 }),
});
const conn = { baseUrl: 'http://canopy', fetch }; // fetch.calls records every request

const { factory, instances } = createFakeWebSocketFactory();
// new ResilientSocket({ url, webSocketFactory: factory, ... }).connect();
// instances[0].open(); instances[0].message({...}); instances[0].close(1006);
```
