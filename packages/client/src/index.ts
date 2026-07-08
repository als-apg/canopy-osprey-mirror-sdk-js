// @slaclab/canopy-client — framework-free TypeScript client for Canopy's live-PV
// protocol (Hare WebSocket) and typed wire DTOs.

export * from './alarm.js';

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
