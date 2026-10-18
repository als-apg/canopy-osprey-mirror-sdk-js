import { type ReactNode } from 'react';
import type { PVService } from '@slaclab/canopy-client';
import { PVServiceContext } from './pvServiceContext.js';

/**
 * Provides the `PVService` used by `usePV`/`usePVService` in the subtree.
 *
 * The app constructs and owns the service (a `HarePVService` against a real
 * backend, or a `MockPVService` for development) and passes it in; there is
 * no default service.
 */
export function PVServiceProvider({
  service,
  children,
}: {
  service: PVService;
  children: ReactNode;
}) {
  return <PVServiceContext.Provider value={service}>{children}</PVServiceContext.Provider>;
}
