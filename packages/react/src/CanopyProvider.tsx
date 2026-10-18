import type { ReactNode } from 'react';
import type { CanopyConnection } from '@slaclab/canopy-client';
import { CanopyConnectionContext } from './canopyContext.js';

export interface CanopyProviderProps {
  /**
   * How to reach Canopy, shared by every hook below (`useCanopyConnection`,
   * `useCanopyJob`). Behind a same-origin proxy that injects the API key this
   * is just `{ baseUrl: '/api/canopy' }`.
   */
  connection: CanopyConnection;
  children: ReactNode;
}

/**
 * Provides the app's `CanopyConnection` to the subtree, so components and
 * hooks stop threading `conn` through props.
 */
export function CanopyProvider({ connection, children }: CanopyProviderProps) {
  return (
    <CanopyConnectionContext.Provider value={connection}>
      {children}
    </CanopyConnectionContext.Provider>
  );
}
