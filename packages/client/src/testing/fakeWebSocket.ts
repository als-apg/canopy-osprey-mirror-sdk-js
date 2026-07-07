import type { WebSocketFactory, WebSocketLike } from '../hare/HarePVService.js';

// Excluded from the built package (see tsconfig.build.json) — import only
// from tests.

const READY_STATE_CONNECTING = 0;
const READY_STATE_OPEN = 1;
const READY_STATE_CLOSED = 3;

/**
 * A `WebSocketLike` test double with no real networking. Starts in the
 * CONNECTING state, matching a freshly constructed real WebSocket.
 */
export class FakeWebSocket implements WebSocketLike {
  readyState: number = READY_STATE_CONNECTING;
  readonly url: string;
  readonly sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === READY_STATE_CLOSED) return;
    this.readyState = READY_STATE_CLOSED;
    // Real sockets fire `onclose` asynchronously even for a client-initiated
    // close; callers rely on this to drive reconnect bookkeeping.
    this.onclose?.();
  }

  /** Test helper: simulate the server accepting the connection. */
  open(): void {
    this.readyState = READY_STATE_OPEN;
    this.onopen?.();
  }

  /** Test helper: simulate an inbound server frame. */
  message(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
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
