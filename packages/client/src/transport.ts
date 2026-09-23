// Environment-agnostic structural transport types shared by the whole package.
//
// No DOM lib, no @types/node: consumers inject their own WebSocket/fetch (or
// the services read them off `globalThis` at call time), so the package never
// names the concrete `WebSocket`/`Response` types from either environment.
//
// These used to live in `hare/HarePVService.ts`; they are re-exported from
// there (and from the package root) under the same names.

/** The fields of a WebSocket `close` event this package reads. */
export interface WebSocketCloseEventLike {
  /** Close code (e.g. 1000 normal, 1006 abnormal, 1008 policy violation). */
  code?: number;
  /** Close reason sent by the peer (browsers hide it for rejected handshakes). */
  reason?: string;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  /**
   * Real sockets pass a `CloseEvent` (which carries `code`/`reason`); test
   * doubles may call it with no argument.
   */
  onclose: ((ev?: WebSocketCloseEventLike) => void) | null;
  onerror: (() => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
