import { createContext, useContext } from 'react';
import type { CanopyConnection } from '@slaclab/canopy-client';

/** The app-wide `CanopyConnection` (see `CanopyProvider`). */
export const CanopyConnectionContext = createContext<CanopyConnection | null>(null);

/** The `CanopyConnection` from the nearest `CanopyProvider`; throws outside one. */
export function useCanopyConnection(): CanopyConnection {
  const connection = useContext(CanopyConnectionContext);
  if (!connection) throw new Error('useCanopyConnection must be used within CanopyProvider');
  return connection;
}
