# @slaclab/canopy-react

React 19 bindings over [`@slaclab/canopy-client`](client.md). Peer
dependencies: `react` and `react-dom` ^19.

| Export                                       | Purpose                                                              |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `CanopyProvider`, `useCanopyConnection`      | One app-wide `CanopyConnection` in context                           |
| `useCanopyJob`, `useJob`                     | Poll a background job: a status model, backoff on transient failures |
| `PVServiceProvider`, `usePV`, `usePVService` | Live PV data from a `PVService` (Hare, mock, local)                  |

The full reference is the
[package README](https://github.com/slaclab/canopy-sdk-js/tree/main/packages/react).

## Connection

```tsx
import { CanopyProvider, useCanopyConnection } from '@slaclab/canopy-react';

root.render(
  <CanopyProvider connection={{ baseUrl: '/api/canopy' }}>
    <App />
  </CanopyProvider>
);

// anywhere below:
const conn = useCanopyConnection(); // throws outside the provider
```

## Background jobs

```tsx
import { useCanopyJob } from '@slaclab/canopy-react';

const { job, status, error, loading } = useCanopyJob(jobId);
```

`status` is `null` (no id yet / first answer pending), `'unknown'`,
`'pending'`, `'running'`, `'completed'` or `'failed'`.

- **`unknown`** means the Jobs API answered `404 job_not_found`: Canopy
  has no record of the id, because it is mistyped or from another
  deployment, or because the job finished and its result expired (after the
  worker's `keep_result_s`, one hour by default). A job still queued, on
  any worker queue, reports `pending`. `unknown` is not a failure: for a
  job you just started, rely on the domain signal (for a dial-in, the run's
  `dial_in` frame) as the definitive outcome.
- Polling runs every `pollMs` (1 s) while pending/running, and backs off
  up to `maxPollMs` (5 s) while unknown or after a transient failure
  (network, 5xx, 408, 429). Transient failures appear on `error` next to
  the last `job` and clear on the next success.
- `notFoundGraceMs` (default 30 s) turns a lasting `unknown` into an
  `error` and stops polling (`0`: the first 404, as in 0.1; `Infinity`:
  never). Other errors (401, 403, 422, or a non-Canopy error such as a
  missing `fetch`) stop polling.
- The request in flight is aborted on unmount and when the id changes.

`useJob(conn, id, options)` is the same hook with an explicit connection.

## Live PVs

```tsx
import { HarePVService } from '@slaclab/canopy-client';
import { PVServiceProvider, usePV } from '@slaclab/canopy-react';

const pvService = new HarePVService({ url: 'wss://canopy.example.org/hare/v1/ws/pvs' });
pvService.connect();

<PVServiceProvider service={pvService}>
  <Readback />
</PVServiceProvider>;

function Readback() {
  const pv = usePV('DEMO:BPM1:X'); // value, displayValue, severity, connected, ..., put()
  return <span>{pv.displayValue}</span>;
}
```

When the PV name changes, `usePV` shows the new PV's cached snapshot (or the
disconnected placeholder) until its first update — never the previous PV's
value, nor what an earlier subscription to the same PV delivered (A → B → A).
