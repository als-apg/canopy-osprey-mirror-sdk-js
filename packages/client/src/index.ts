// @slaclab/canopy-client — framework-free TypeScript client for Canopy's
// protocols: Hare live PVs (WebSocket), Fox formulas (WebSocket), Mole history
// (REST), background jobs (REST), the shared REST core, and typed wire DTOs.

export * from './alarm.js';

export type {
  AbortSignalLike,
  CanopyConnection,
  CanopyFetchOptions,
  ErrorEnvelope,
} from './rest/canopyFetch.js';
export { CanopyError, canopyFetch } from './rest/canopyFetch.js';

export * from './time.js';

export * from './wire.js';

export * from './fox/types.js';
export type {
  FoxConnectionStatus,
  FoxError,
  FoxFormulaServiceOptions,
  FoxSubscribeOptions,
} from './fox/FoxFormulaService.js';
export { FoxFormulaService } from './fox/FoxFormulaService.js';

export * from './mole/types.js';
export * from './mole/mole.js';

export * from './jobs/types.js';
export * from './jobs/jobs.js';

export type { PVData, PVListener, PVService } from './pv/PVService.js';
export { DISCONNECTED_PV } from './pv/PVService.js';
export { MockPVService } from './pv/MockPVService.js';

export * from './hare/types.js';

export type {
  WebSocketLike,
  WebSocketFactory,
  FetchLike,
  HareConnectionStatus,
  HareError,
  HarePVServiceOptions,
  HareWriteOptions,
} from './hare/HarePVService.js';
export { HarePVService } from './hare/HarePVService.js';
