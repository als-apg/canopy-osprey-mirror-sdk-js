# @slaclab/canopy-react

React 19 bindings over [`@slaclab/canopy-client`](client.md). Peer
dependencies: `react` and `react-dom` ^19.

| Export                                       | Purpose                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `CanopyProvider`, `useCanopyConnection`      | One app-wide `CanopyConnection` in context                                      |
| `useCanopyJob`, `useJob`                     | Poll a background job with a status model that survives Canopy's queued-job 404 |
| `PVServiceProvider`, `usePV`, `usePVService` | Live PV data from a `PVService` (Hare, mock, local)                             |

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

- **`unknown`** means the Jobs API answered `404 job_not_found`. Canopy
  does that while a job is still queued on a worker queue it cannot see
  (optimization dial-in, reset and checkpoint jobs share the run queue and
  can wait minutes) and after its result expired. It is never treated as a
  failure; show something like "Queued: waiting for a worker slot" and rely
  on the domain signal (for a dial-in, the run's `dial_in` frame) as the
  definitive outcome.
- Polling runs every `pollMs` (1 s) while pending/running, and backs off
  up to `maxPollMs` (5 s) while unknown or after a transient failure
  (network, 5xx, 408, 429). Transient failures appear on `error` next to
  the last `job` and clear on the next success.
- `notFoundGraceMs` (default: none) turns a lasting `unknown` into an
  `error`. Other errors (401, 403, 422, ...) stop polling.
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
  const pv = usePV('BPMS:LI21:233:X'); // value, displayValue, severity, connected, ..., put()
  return <span>{pv.displayValue}</span>;
}
```

When the PV name changes, `usePV` shows the new PV's cached snapshot (or the
disconnected placeholder) until its first update — never the previous PV's
value.
