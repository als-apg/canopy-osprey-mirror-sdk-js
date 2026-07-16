import { useState, useEffect, useCallback } from 'react';
import { usePVService } from './pvServiceContext.js';
import type { PVData } from '@slaclab/canopy-client';
import { DISCONNECTED_PV } from '@slaclab/canopy-client';

export interface PVHandle extends PVData {
  address: string;
  put: (value: number | string | boolean) => void;
}

/**
 * The sole PV data access primitive.
 * Returns live PV data including value, alarm severity, connection status,
 * timestamp, units, and limits.
 */
export function usePV(pvName: string | undefined): PVHandle {
  const service = usePVService();
  const [data, setData] = useState<PVData>(
    pvName ? (service.getSnapshot(pvName) ?? DISCONNECTED_PV) : DISCONNECTED_PV
  );

  useEffect(() => {
    if (!pvName) {
      // TODO: refactor so the disconnected case is derived during render
      // rather than synchronously setting state in this effect. See
      // react-hooks/set-state-in-effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(DISCONNECTED_PV);
      return;
    }

    const unsubscribe = service.subscribe(pvName, setData);
    return unsubscribe;
  }, [pvName, service]);

  const put = useCallback(
    (value: number | string | boolean) => {
      if (pvName) {
        service.put(pvName, value);
      }
    },
    [pvName, service]
  );

  return {
    ...data,
    address: pvName ?? '',
    put,
  };
}
