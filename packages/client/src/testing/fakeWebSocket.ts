import type { WebSocketCloseEventLike, WebSocketFactory, WebSocketLike } from '../transport.js';

// Published as part of `@slaclab/canopy-client/testing` (see ./index.ts).
// Keep it free of test-runner imports: consumers use it from any framework.

const READY_STATE_CONNECTING = 0;
const READY_STATE_OPEN = 1;
const READY_STATE_CLOSED = 3;

/** Code a real socket reports for a close without a status code. */
const NO_STATUS_RECEIVED = 1005;

/**
 * A `WebSocketLike` test double with no real networking. Starts in the
 * CONNECTING state, matching a freshly constructed real WebSocket. Drive it
 * with `open()`, `message(frame)` and `close(code?, reason?)`, and inspect
 * what the code under test sent with `sent` / `parsedSent()`.
 */
export class FakeWebSocket implements WebSocketLike {
  readyState: number = READY_STATE_CONNECTING;
  readonly url: string;
  readonly sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: WebSocketCloseEventLike) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  /**
   * Close the socket and fire `onclose` with `{code, reason}` (code 1005 when
   * omitted). Serves both a client-initiated close and, from a test, a
   * server-initiated one (e.g. `close(1008, 'invalid_api_key')`). A no-op
   * once closed.
   */
  close(code?: number, reason?: string): void {
    if (this.readyState === READY_STATE_CLOSED) return;
    this.readyState = READY_STATE_CLOSED;
    // Real sockets fire `onclose` asynchronously even for a client-initiated
    // close; callers rely on this to drive reconnect bookkeeping.
    this.onclose?.({ code: code ?? NO_STATUS_RECEIVED, reason: reason ?? '' });
  }

  /** Test helper: simulate the server accepting the connection. */
  open(): void {
    this.readyState = READY_STATE_OPEN;
    this.onopen?.();
  }

  /** Test helper: simulate an inbound server frame (JSON-serialized). */
  message(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Test helper: simulate an inbound message with raw `data` (not serialized). */
  messageRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** Test helper: fire `onerror` (a real socket follows it with a close). */
  error(): void {
    this.onerror?.();
  }

  /** Parse every sent message as JSON, in send order. */
  parsedSent(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

/** A `WebSocketFactory` that records every `FakeWebSocket` it creates, in creation order. */
export function createFakeWebSocketFactory(): {
  factory: WebSocketFactory;
  instances: FakeWebSocket[];
} {
  const instances: FakeWebSocket[] = [];
  const factory: WebSocketFactory = (url: string) => {
    const socket = new FakeWebSocket(url);
    instances.push(socket);
    return socket;
  };
  return { factory, instances };
}
