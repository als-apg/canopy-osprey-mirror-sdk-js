// @slaclab/canopy-client/testing — test doubles for code built on the client:
// a scriptable WebSocket (for anything taking a `webSocketFactory`) and a
// route-matching fetch (for anything taking a `CanopyConnection`).
//
// A separate entry point, not part of the root barrel, so production bundles
// never include it. Framework-free: works with any test runner.

export { FakeWebSocket, createFakeWebSocketFactory } from './fakeWebSocket.js';
export { createFakeFetch, jsonResponse } from './fakeFetch.js';
export type {
  CreateFakeFetchOptions,
  FakeFetch,
  FakeFetchRequest,
  FakeResponse,
  FakeRoute,
  FakeRouteHandler,
  FakeRouteStep,
  FakeRoutes,
} from './fakeFetch.js';
