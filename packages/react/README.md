# @slaclab/canopy-react

React bindings over [`@slaclab/canopy-client`](../client): a context provider for the
`PVService`, the `usePV` hook (ported from `canopy-screen-builder`), and the
`useJob` polling hook for background jobs.

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
with unbound addresses render harmlessly.

`usePVService()` returns the raw `PVService` from context and throws when no
`PVServiceProvider` is above the caller.

## useJob

`useJob(conn, jobId | null, { pollMs? })` polls a Canopy background job
(`GET /jobs/v1/{id}`) while the component is mounted and the job is
non-terminal, returning `{ job, error, loading }`:

```tsx
import { useJob } from '@slaclab/canopy-react';

function RestoreProgress({ jobId }: { jobId: string | null }) {
  const { job, error, loading } = useJob(
    { baseUrl: 'https://canopy.example.org', apiKey: 'my-api-key' },
    jobId
  );

  if (loading) return <span>starting…</span>;
  if (error) return <span>failed to poll: {error.message}</span>;
  if (!job) return null;
  return <progress value={job.progress} max={100} data-status={job.status} />;
}
```

Polling stops on a terminal status (`completed`/`failed` — branch on
`job.status`), on a fetch error (surfaced via `error`), when `jobId`
changes, or on unmount. Pass `null` to render without a job.
