# @slaclab/canopy-client

Framework-free TypeScript client for Canopy's wire protocols: Hare live PVs
(WebSocket), Fox formula subscriptions (WebSocket), Mole history (REST),
background jobs (REST), the shared REST core, a reconnecting WebSocket for
any Canopy stream (`ResilientSocket`), epoch-nanosecond time helpers, and the
typed wire DTOs for all of them. Pure TypeScript — no React, no DOM lib
dependency, no `@types/node`. Runs unmodified in browsers, Node, and tests
(every WebSocket user takes an injectable `WebSocketFactory`, and every REST
call takes an injectable `fetch`). Test doubles for both ship as
[`@slaclab/canopy-client/testing`](#testing).

React bindings (hooks, context providers) live in `@slaclab/canopy-react`, not here.

## Connections (REST core)

REST-side helpers (Mole, jobs, Hare writes) all take a `CanopyConnection`
saying how to reach one Canopy deployment:

```ts
import { canopyFetch, CanopyError } from '@slaclab/canopy-client';
import type { CanopyConnection } from '@slaclab/canopy-client';

const conn: CanopyConnection = {
  baseUrl: 'https://canopy.example.org', // module paths like /mole/v1/... are appended
  apiKey: 'my-api-key', // sent as X-API-Key on every request
  // fetch: customFetch,                 // injectable; defaults to globalThis.fetch
};
```

`baseUrl` is explicit by design: the SDK can target any deployment directly
and send `X-API-Key` itself. Behind a same-origin proxy that injects the key
(e.g. `@slaclab/canopy-vite` in development, nginx in production), use the
proxy prefix and no key: `{ baseUrl: '/api/canopy' }`.

`canopyFetch<T>(conn, path, { method?, query?, body?, signal? })` underlies
every helper. `body` is sent as JSON (`Content-Type: application/json`),
except a `FormData`, which is passed to `fetch` untouched so it sets the
multipart boundary itself. An empty 2xx body resolves to `undefined`.

### Error handling

Every failure is a `CanopyError` with a machine-readable `code`, the HTTP
`status` (0 when no response arrived) and a human-readable `detail` (always
a string):

| Response                                                           | `code`                           | `detail`                               |
| ------------------------------------------------------------------ | -------------------------------- | -------------------------------------- |
| Canopy envelope `{"code": "run_not_found", "detail": "..."}`       | the envelope's `code`            | the envelope's `detail`                |
| FastAPI validation `422 {"detail": [{loc, msg, type}, ...]}`       | `validation_error`               | `"body.bounds: Value error, ...; ..."` |
| Framework error without a code, e.g. `404 {"detail": "Not Found"}` | `not_found` (404) / `http_error` | the `detail` text                      |
| Non-JSON body (e.g. a proxy's `502 Bad Gateway`)                   | `unknown_error`                  | the raw body, or `HTTP <status>`       |
| No response (DNS, refused, CORS), or the body cut off mid-read     | `network_error` (status 0)       | the fetch error message                |

A `validation_error` also carries the structured entries on `issues`
(`{ loc, msg, type, input?, ctx? }[]`), so forms can map them onto fields.
Aborts are not wrapped: the `AbortError` passes through unchanged, so
callers can tell cancellation from failure.

```ts
try {
  await canopyFetch(conn, '/optimization/v1/routines', { method: 'POST', body: spec });
} catch (err) {
  if (err instanceof CanopyError && err.code === 'validation_error') {
    for (const issue of err.issues ?? []) console.warn(issue.loc.join('.'), issue.msg);
  }
}
```

## Live PVs (Hare)

The package centers on a small `PVService` abstraction (subscribe to a PV,
get notified of updates, write a new value) with two implementations:

- `HarePVService` — talks to a real Canopy Hare backend over
  `WS /hare/v1/ws/pvs` (live values) and `PUT /hare/v1/pvs/{pv}` (writes).
- `MockPVService` — simulates PV data locally, for development and demos
  without a backend.

```ts
import { HarePVService } from '@slaclab/canopy-client';

const pvService = new HarePVService({
  url: 'wss://canopy.example.org/hare/v1/ws/pvs',
  apiKey: 'my-api-key', // sent as ?api_key= on the WS URL, X-API-Key on writes
  onStatusChange: (status) => console.log('connection status:', status),
  onError: (error) => console.error('hare error:', error.code, error.message),
});

pvService.connect();

const unsubscribe = pvService.subscribe('BPMS:LI21:233:X', (data) => {
  console.log(data.displayValue, data.severity, data.connected);
});

// Fire-and-forget write (errors routed to onError):
pvService.put('BPMS:LI21:233:X', 3.2);

// Or await the result / pass write options (failures throw CanopyError):
await pvService.write('BPMS:LI21:233:X', 3.2, { wait: false, timeoutS: 5 });

unsubscribe();
pvService.disconnect();
```

`HarePVService` takes an injectable `webSocketFactory` and `fetchFn` (for
Node consumers or tests without a global `WebSocket`/`fetch`), reconnects
automatically with capped exponential backoff, and resubscribes every PV
that still has listeners after a reconnect. See `HarePVServiceOptions` in
`src/hare/HarePVService.ts` for the full set of tunables (heartbeat
interval, pong timeout, reconnect delays, REST base URL override,
`terminalCloseCodes`). A close with code 1008 (Canopy's "invalid API key",
seen by Node clients) stops the reconnect loop and reports
`ws_terminal_close` through `onError` until `connect()` is called again;
pass `terminalCloseCodes: []` to always reconnect.

`MockPVService` implements the same `PVService` interface but generates
realistic-looking simulated values locally (with alarm transitions) based on
naming conventions in the PV name (e.g. `TEMP`, `CURRENT`, `PRESSURE`).

## Formulas (Fox)

`FoxFormulaService` streams live formula evaluations over
`WS {baseUrl}/fox/v1/ws/formulas`. It knows `FormulaSpec` only — expression,
token→PV bindings, and evaluation options — with no naming conventions or
screen-level rule types. `baseUrl` may also be relative, such as the dev
proxy's `/api/canopy`; it is resolved against the page like `toWsUrl` does
(outside a browser, pass an absolute base or `wsUrl`):

```ts
import { FoxFormulaService } from '@slaclab/canopy-client';

const fox = new FoxFormulaService({
  baseUrl: 'https://canopy.example.org', // http(s) is switched to ws(s)
  apiKey: 'my-api-key', // sent as ?api_key= on the WS URL
});
fox.connect();

const unsubscribe = fox.subscribe(
  { kind: 'scalar', expression: 'A - B', bindings: { A: 'PV:ONE', B: 'PV:TWO' } },
  {
    // t0Ns / t1Ns / intervalMs are optional (live push mode by default)
    onResult: (data) => console.log(data.kind, data.scalar?.value),
    onError: (err) => console.error('formula error:', err.code, err.message),
  }
);

unsubscribe();
fox.dispose();
```

Subscription ids are server-assigned; the service correlates replies through
a FIFO of in-flight subscribes, so after its automatic reconnect (same
capped backoff, ping/pong liveness and terminal close codes as
`HarePVService`) every held subscription is re-sent and the freshly
assigned ids are remapped onto the existing callbacks transparently.

## Streams (`ResilientSocket`)

`HarePVService` and `FoxFormulaService` are built on `ResilientSocket`, a
JSON WebSocket that keeps itself connected. Use it for any other Canopy
stream (e.g. the optimization run stream): the protocol code only
(re)subscribes in `onOpen` and handles frames.

```ts
import { ResilientSocket, toWsUrl } from '@slaclab/canopy-client';

const socket = new ResilientSocket({
  url: toWsUrl('/api/canopy', '/optimization/v1/ws/runs'), // ws(s)://<page host>/api/canopy/...
  jitterMs: 250, // spread reconnects of many clients (default 0)
  label: 'RunStream', // used in error messages
  onOpen: (send) => {
    // Runs on every (re)connect, status already 'connected'.
    for (const [runId, cursor] of held) send({ type: 'subscribe', runId, sinceSeq: cursor });
  },
  onFrame: (frame) => handle(frame), // every inbound JSON object
  onClose: ({ code, reason }) => pendingReplies.clear(), // per-socket state dies here
  onStatusChange: (status) => setConnection(status),
  onError: (error) => console.warn(error.code, error.message),
});
socket.connect();
socket.send({ type: 'unsubscribe', runId }); // false (nothing sent) unless OPEN
socket.close(); // stop for good (status 'closed')
```

Behaviour:

- **Status**: `idle` → `connecting` → `connected`; a drop gives
  `disconnected` while a reconnect is pending; `closed` after `close()` or
  a terminal close code. `connect()` is idempotent and supersedes a pending
  reconnect.
- **Reconnect**: capped backoff over `reconnectDelaysMs` (default
  `[1000, 2000, 4000, 8000, 15000]`, reset once a connection receives its
  first frame, so a server that accepts and then closes is still backed
  off), plus a random `0..jitterMs` (default 0).
- **Liveness**: `{"type":"ping"}` every `pingIntervalMs` (15 s); if no frame
  of any kind arrives within `pongTimeoutMs` (10 s) of a ping, the socket is
  dropped and reconnected without waiting for a close handshake.
- **Terminal close codes**: `terminalCloseCodes` (default `[1008]`) stop the
  loop and report `ws_terminal_close`. Only non-browser clients see them:
  browsers report a rejected handshake as 1006, which always reconnects.
  Browser apps should detect auth failure through REST, probed on the same
  module the socket connects to: 401 `invalid_api_key`, or 403
  `insufficient_module_access` when the key isn't scoped to that module (a
  key that works for squirrel's REST API can still be refused by Hare's
  socket). Then call `close()`/`connect()` themselves.
- **Auth**: `apiKey` is appended as `?api_key=` (browsers cannot set
  WebSocket headers); behind a key-injecting proxy, leave it unset.
- Events from a socket that has since been replaced are ignored, and
  `onClose` is not called for an explicit `close()`.

`toWsUrl(baseUrl, path, loc?)` maps `http(s)` to `ws(s)` and resolves a
relative base (`''`, `/api/canopy`) against `loc` or
`globalThis.location`, the way `fetch` resolves it.

## History (Mole)

Typed wrappers over Mole's REST API, all taking the `CanopyConnection`:

```ts
import {
  fetchData,
  fetchMetadata,
  searchPVs,
  listArchivers,
  nowNs,
  msToNs,
} from '@slaclab/canopy-client';

const toNs = nowNs();
const data = await fetchData(conn, 'BPMS:LI21:233:X', {
  fromNs: toNs - msToNs(60 * 60 * 1000),
  toNs,
  binning: 'auto',
  maxPoints: 800,
});
if (data.mode === 'binned') console.log(data.points.length, 'buckets');

await fetchMetadata(conn, 'BPMS:LI21:233:X');
await searchPVs(conn, 'BPMS.*', { limit: 50 });
await listArchivers(conn);
```

## Background jobs

Long-running Canopy operations return a `JobCreatedDTO`; poll the job with:

```ts
import { getJob, awaitJob, JobFailedError } from '@slaclab/canopy-client';

const status = await getJob(conn, jobId); // one GET /jobs/v1/{jobId}

try {
  const done = await awaitJob(conn, jobId, { pollMs: 500, timeoutMs: 60_000 });
  console.log('result:', done.result);
} catch (err) {
  if (err instanceof JobFailedError) console.error('job failed:', err.job.error);
}
```

`awaitJob` resolves on `completed`, rejects with `JobFailedError` on
`failed`, `CanopyError('job_timeout')` on timeout, and the abort reason when
its `signal` aborts.

Canopy's Jobs API answers `404 job_not_found` when it has no record of the
id: it is mistyped or from another deployment, or the job finished and its
result expired (after the worker's `keep_result_s`, one hour by default). A
job still waiting on a worker queue, the optimization worker's included,
reports `pending`. By default `awaitJob` rejects on the 404; pass
`notFoundGraceMs` to keep polling through it for that long (`Infinity`
together with `timeoutMs` for "until the deadline"), e.g. against an older
backend. `isJobNotFoundError(err)` identifies the 404.

## Time helpers

Canopy's APIs share one time domain — integer epoch nanoseconds (Mole
`from`/`to`, Fox `t0Ns`/`t1Ns`, sample `tsNs`). `src/time.ts` exports
`nowNs`, `msToNs`, `nsToMs`, `dateToNs`, and `nsToDate` to convert between
that and JS epoch milliseconds / `Date`.

## Testing

`@slaclab/canopy-client/testing` is a separate entry point (never part of
the root import, so production bundles skip it) with framework-free test
doubles:

```ts
import {
  createFakeFetch,
  createFakeWebSocketFactory,
  jsonResponse,
} from '@slaclab/canopy-client/testing';

// REST: route-matching fetch fake.
const fetch = createFakeFetch({
  'GET /jobs/v1/:id': [jsonResponse(pendingJob), jsonResponse(doneJob)], // one per call, last repeats
  'POST /optimization/v1/runs': (req) => jsonResponse({ id: 'r1', ...(req.json as object) }),
  '/health': jsonResponse({ status: 'ok' }), // any method
});
const conn = { baseUrl: 'http://canopy', fetch };
// ... run the code under test, then:
fetch.calls; // [{ method, url, path, query, params, headers, body, json }, ...]

// WebSocket: a factory that records every socket it creates.
const { factory, instances } = createFakeWebSocketFactory();
const service = new HarePVService({ url: 'ws://h/hare/v1/ws/pvs', webSocketFactory: factory });
service.connect();
instances[0].open(); // server accepts
instances[0].message({ type: 'initial', data: {}, meta: {}, count: 0 }); // inbound frame
instances[0].parsedSent(); // what the client sent
instances[0].close(1008, 'invalid_api_key'); // server close with a code
```

`createFakeFetch(routes, { baseUrl? })` matches `'METHOD /path'` or
`'/path'` keys (`:name` segments land on `req.params`), answers with a fixed
response, a handler (throw to simulate a network failure), or a sequence of
either; unmatched requests get a FastAPI-style 404, and abort signals are
honoured. `fetch.set(route, response)` changes a route mid-test.

## Wire DTOs

Each module directory exports the camelCase wire types its backend
sends/accepts, mirroring Canopy's Python contracts (whose pydantic base
serializes snake_case to camelCase on the wire):

- `src/hare/types.ts` — `PVValueDTO`, `PVMetaDTO`, `HareServerFrame`,
  `HareClientMessage`, `PVWriteRequestDTO`, ... (`canopy.contracts.pv`,
  `canopy.hare.schemas.pv`)
- `src/fox/types.ts` — `FormulaSpec`, `FormulaResultDTO`, `FoxServerFrame`,
  ... (`canopy.contracts.formula`, `canopy.fox.api.v1.ws`)
- `src/mole/types.ts` — `ArchiverDataDTO`, `PVMetadataDTO`,
  `SearchResultsDTO`, ... (`canopy.mole.schemas`)
- `src/jobs/types.ts` — `JobStatusDTO`, `JobCreatedDTO`
  (`canopy.jobs.schemas.job`, `canopy.contracts.jobs`)
- `src/wire.ts` — shared primitives (`WireAlarmSeverity`)
- `src/pv/` — the `PVService` abstraction and its local implementations
  (`MockPVService`, `LocalPVService` for `loc://name?type=&init=` PVs,
  `RoutedPVService` for scheme-prefix routing)

## Migrating from 0.1

**`FetchLike`'s `init.body` is wider.** In 0.1 it was
`body: string`; in 0.2 it is `body?: string | FormData` (absent for
requests without a body, and a `FormData` passed through untouched for
multipart uploads). The global `fetch` and `createFakeFetch` still fit. A
hand-typed fetch wrapper that declares `body: string` no longer type-checks
as a `FetchLike` under `strictFunctionTypes` (part of `strict`); widen its
parameter, most simply to the SDK's own type:

```ts
import type { FetchLike } from '@slaclab/canopy-client';

// Before: (url: string, init: { method: string; headers: Record<string, string>; body: string })
function loggingFetch(url: string, init: Parameters<FetchLike>[1]) {
  console.debug(init.method, url);
  return fetch(url, init);
}

const conn = { baseUrl: '/api/canopy', fetch: loggingFetch };
```
