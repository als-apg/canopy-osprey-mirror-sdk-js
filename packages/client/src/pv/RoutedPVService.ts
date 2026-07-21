import type { PVService, PVData, PVListener } from './PVService.js';

/**
 * Scheme router over PVServices: addresses whose scheme matches a route go to
 * that service, everything else to the fallback. The composition root builds
 * one (e.g. `loc://` → LocalPVService, fallback → HarePVService) and hands it
 * to widgets as THE PVService — widgets stay scheme-unaware.
 */
export class RoutedPVService implements PVService {
  private readonly routes: ReadonlyArray<[prefix: string, service: PVService]>;
  private readonly fallback: PVService;

  constructor(routes: Record<string, PVService>, fallback: PVService) {
    this.routes = Object.entries(routes);
    this.fallback = fallback;
  }

  private serviceFor(pvName: string): PVService {
    for (const [prefix, service] of this.routes) {
      if (pvName.startsWith(prefix)) return service;
    }
    return this.fallback;
  }

  subscribe(pvName: string, listener: PVListener): () => void {
    return this.serviceFor(pvName).subscribe(pvName, listener);
  }

  put(pvName: string, value: number | string | boolean): void {
    this.serviceFor(pvName).put(pvName, value);
  }

  getSnapshot(pvName: string): PVData | undefined {
    return this.serviceFor(pvName).getSnapshot(pvName);
  }

  connect(): void {
    for (const [, service] of this.routes) service.connect();
    this.fallback.connect();
  }

  disconnect(): void {
    for (const [, service] of this.routes) service.disconnect();
    this.fallback.disconnect();
  }

  get isConnected(): boolean {
    return this.fallback.isConnected;
  }
}
