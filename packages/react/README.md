# @slaclab/canopy-react

React bindings over [`@slaclab/canopy-client`](../client): an app-wide
`CanopyProvider` for the `CanopyConnection`, a context provider for the
`PVService`, the `usePV` hook (ported from `canopy-screen-builder`), and the
`useJob` / `useCanopyJob` polling hooks for background jobs.

Peer dependencies: `react`, `react-dom` (^19).

## Usage

The app constructs and owns the service — a `HarePVService` against a real
Canopy backend, or a `MockPVService` for development — and hands it to the
provider:

```tsx
import { HarePVService } from '@slaclab/canopy-client';
import { PVServiceProvider, usePV } from '@slaclab/canopy-react';

const pvService = new HarePVService({
  url: 'wss://canopy.example.org/hare/v1/ws/pvs',
  apiKey: 'my-api-key',
});
pvService.connect();

function App() {
  return (
    <PVServiceProvider service={pvService}>
      <Readback />
    </PVServiceProvider>
  );
}

function Readback() {
  const pv = usePV('BPMS:LI21:233:X');
  return (
    <span data-severity={pv.severity} data-connected={pv.connected}>
      {pv.displayValue}
    </span>
  );
}
```

`usePV(pvName)` returns a `PVHandle`: the live `PVData` (value,
`displayValue`, alarm `severity`, `connected`, `timestamp`, `units`,
`precision`, limits) plus `address` and a `put(value)` writer. Passing
`undefined` as the PV name yields the disconnected placeholder, so widgets
with unbound addresses render harmlessly. When `pvName` changes, the handle
shows the new PV's cached snapshot (or the placeholder) until its first
update — never the previous PV's value, nor (after switching back, e.g.
A → B → A) what an earlier subscription to the same PV delivered.

`usePVService()` returns the raw `PVService` from context and throws when no
`PVServiceProvider` is above the caller.

## CanopyProvider

Put the app's `CanopyConnection` in context once, instead of threading
`conn` through props:

```tsx
import { CanopyProvider, useCanopyConnection } from '@slaclab/canopy-react';

// Behind a same-origin proxy that injects the API key (see @slaclab/canopy-vite):
const connection = { baseUrl: '/api/canopy' };

root.render(
  <CanopyProvider connection={connection}>
    <App />
  </CanopyProvider>
);

function useRuns() {
  const conn = useCanopyConnection(); // throws outside a CanopyProvider
  // ... canopyFetch(conn, '/optimization/v1/runs') via your data layer
}
```

## Background jobs: useCanopyJob / useJob

`useCanopyJob(jobId | null, options?)` polls a Canopy background job
(`GET /jobs/v1/{id}`) with the provider's connection while the component is
mounted; `useJob(conn, jobId | null, options?)` does the same with an
explicit connection. Both return `{ job, status, error, loading }`:

```tsx
import { useCanopyJob } from '@slaclab/canopy-react';

function DialInProgress({ jobId }: { jobId: string | null }) {
  const { job, status, error } = useCanopyJob(jobId);

  if (status === 'unknown' && error) return <span>Job not found</span>; // grace ran out
  if (status === 'unknown') return <span>Looking for the job…</span>;
  if (status === 'failed') return <span>Failed: {job?.error}</span>;
  if (status === 'completed') return <span>Done</span>;
  return (
    <span>
      {status ?? 'starting'}… {error && `(retrying: ${error.message})`}
    </span>
  );
}
```

`status` is one of:

| `status`                  | Meaning                                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `null`                    | No id, or the first answer has not arrived (`loading` is true while it is in flight).                                                                                                                                                                    |
| `'unknown'`               | The Jobs API answered `404 job_not_found`: Canopy has no record of the id (mistyped, another deployment's) or the result expired (after the worker's `keep_result_s`, 1 h by default). Not a failure. A queued job, on any worker queue, is `'pending'`. |
| `'pending'`, `'running'`  | `job.status`; polling continues every `pollMs`.                                                                                                                                                                                                          |
| `'completed'`, `'failed'` | Terminal `job.status`; polling stops. A failed job is a status, not an `error`.                                                                                                                                                                          |

Polling and errors:

- Every `pollMs` (default 1000) while pending/running.
- While `unknown`, or after a **transient** failure (network error, 5xx,
  408, 429, unparseable body), polls back off — `pollMs`, doubling, up to
  `maxPollMs` (default 5000) — and never stop on their own. A transient
  failure is surfaced on `error` next to the last good `job`, and cleared
  by the next successful poll.
- `notFoundGraceMs` (default 30000) turns a job that stays `unknown` that
  long (from the first poll) into an `error` (the 404 `CanopyError`) and
  stops polling. `0` surfaces the first 404; `Infinity` never gives up.
- Any other error (401, 403, 422, a routing 404, ...) is surfaced on
  `error` and stops polling. So does an error that is not a `CanopyError`,
  such as a missing `fetch` implementation: retrying cannot fix it.
- Changing the id or unmounting stops polling and aborts the request in
  flight. Results are keyed by id, so a stale job never leaks through.

## Migrating from 0.1

`useJob(conn, id, { pollMs })` still works unchanged; `maxPollMs`,
`notFoundGraceMs`, the `status` field and `useCanopyJob` are new. What
changed in behaviour:

| 0.1                                               | 0.2                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A 404 was surfaced on `error` and polling stopped | A 404 `job_not_found` is `status: 'unknown'`, polled with backoff; after `notFoundGraceMs` (30 s) it is surfaced on `error` and stops |
| Every failed poll stopped polling                 | Transient failures (network, 5xx, 408, 429, bad JSON) keep polling with backoff up to `maxPollMs`; others stop                        |
| —                                                 | `status` (`'unknown'` or `job.status`) next to `job`, `error` and `loading`                                                           |

To keep the 0.1 handling of a 404, pass `{ notFoundGraceMs: 0 }` (Badger
does). Code that treated any `error` as final should now check `status`
too: an `error` next to `'pending'`/`'running'` is a transient failure
that the next poll may clear.
