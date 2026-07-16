# @slaclab/canopy-client

Framework-free TypeScript client for Canopy's wire protocols: Hare live PVs
(WebSocket), Fox formula subscriptions (WebSocket), Mole history (REST),
background jobs (REST), the shared REST core, epoch-nanosecond time helpers,
and the typed wire DTOs for all of them. Pure TypeScript — no React, no DOM
lib dependency, no `@types/node`. Runs unmodified in browsers, Node, and
tests (both services take an injectable `WebSocketFactory`, and every REST
call takes an injectable `fetch`).

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

`baseUrl` is explicit by design: unlike react-trace's original API layer
(which assumed a same-origin dev proxy at `''` injecting the key), the SDK
targets any deployment directly and sends `X-API-Key` itself.

`canopyFetch<T>(conn, path, { method?, query?, body?, signal? })` underlies
every helper. Non-2xx responses throw `CanopyError` carrying the backend's
`{code, detail}` error envelope (plus the HTTP status); network failures
normalize to `CanopyError('network_error', 0, ...)`; aborts pass through
unchanged so callers can tell cancellation from failure.

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
interval, pong timeout, reconnect delays, REST base URL override).

`MockPVService` implements the same `PVService` interface but generates
realistic-looking simulated values locally (with alarm transitions) based on
naming conventions in the PV name (e.g. `TEMP`, `CURRENT`, `PRESSURE`).

## Formulas (Fox)

`FoxFormulaService` streams live formula evaluations over
`WS {baseUrl}/fox/v1/ws/formulas`. It knows `FormulaSpec` only — expression,
token→PV bindings, and evaluation options — with no naming conventions or
screen-level rule types:

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
capped backoff and ping/pong liveness scheme as `HarePVService`) every held
subscription is re-sent and the freshly assigned ids are remapped onto the
existing callbacks transparently.

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

## Time helpers

Canopy's APIs share one time domain — integer epoch nanoseconds (Mole
`from`/`to`, Fox `t0Ns`/`t1Ns`, sample `tsNs`). `src/time.ts` exports
`nowNs`, `msToNs`, `nsToMs`, `dateToNs`, and `nsToDate` to convert between
that and JS epoch milliseconds / `Date`.

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
