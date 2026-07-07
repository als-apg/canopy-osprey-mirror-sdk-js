import { createContext, useContext } from 'react';
import type { PVService } from '@canopy/client';

export const PVServiceContext = createContext<PVService | null>(null);

export function usePVService(): PVService {
  const svc = useContext(PVServiceContext);
  if (!svc) throw new Error('usePVService must be used within PVServiceProvider');
  return svc;
}
