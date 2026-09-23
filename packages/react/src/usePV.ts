import { useState, useEffect, useCallback } from 'react';
import { usePVService } from './pvServiceContext.js';
import type { PVData, PVService } from '@slaclab/canopy-client';
import { DISCONNECTED_PV } from '@slaclab/canopy-client';

export interface PVHandle extends PVData {
  address: string;
  put: (value: number | string | boolean) => void;
}

/** The last update a subscription delivered, tagged with what it was for. */
interface Received {
  service: PVService;
  pvName: string;
  data: PVData;
}

/**
 * The sole PV data access primitive.
 * Returns live PV data including value, alarm severity, connection status,
 * timestamp, units, and limits.
 *
 * The data is always for the current `pvName`: after the name (or the
 * service) changes, it is the service's cached snapshot for the new PV (or
 * the disconnected placeholder) until the new subscription delivers — never
 * the previous PV's value.
 */
export function usePV(pvName: string | undefined): PVHandle {
  const service = usePVService();
  const [received, setReceived] = useState<Received | null>(null);

  useEffect(() => {
    if (!pvName) return;
    return service.subscribe(pvName, (data) => {
      setReceived({ service, pvName, data });
    });
  }, [pvName, service]);

  let data: PVData = DISCONNECTED_PV;
  if (pvName) {
    data =
      received !== null && received.service === service && received.pvName === pvName
        ? received.data
        : (service.getSnapshot(pvName) ?? DISCONNECTED_PV);
  }

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
