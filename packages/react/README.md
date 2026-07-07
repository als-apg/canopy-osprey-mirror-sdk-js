# @canopy/react

React bindings over [`@canopy/client`](../client): a context provider for the
`PVService` and the `usePV` hook, ported from `canopy-screen-builder`.

Peer dependencies: `react`, `react-dom` (^19).

## Usage

The app constructs and owns the service — a `HarePVService` against a real
Canopy backend, or a `MockPVService` for development — and hands it to the
provider:

```tsx
import { HarePVService } from '@canopy/client';
import { PVServiceProvider, usePV } from '@canopy/react';

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
