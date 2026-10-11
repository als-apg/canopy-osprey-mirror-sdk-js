// A reconnecting JSON WebSocket for Canopy's streaming endpoints.
//
// Extracted from the connection skeleton HarePVService and FoxFormulaService
// used to duplicate: connect / capped-backoff reconnect / resubscribe on open
// / ping + pong-deadline liveness / orphaned-socket guards. Protocol services
// (Hare, Fox, the optimization run stream) sit on top and only deal with
// frames and (re)subscription.

import type { WebSocketCloseEventLike, WebSocketFactory, WebSocketLike } from '../transport.js';

/**
 * Connection state of a {@link ResilientSocket}.
 *
 * - `idle`: never connected.
 * - `connecting`: a socket is being opened.
 * - `connected`: the socket is open.
 * - `disconnected`: the socket dropped; a reconnect is scheduled.
 * - `closed`: stopped — `close()` was called, or the server closed with a
 *   terminal close code. Only `connect()` starts it again.
 */
export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'closed';

/** Close code/reason of a socket that closed on its own. */
export interface SocketCloseInfo {
  code?: number;
  reason?: string;
}

/** Connection-level error reported through `onError`. */
export interface SocketError {
  /** `ws_connect_failed` (the factory threw) or `ws_terminal_close`. */
  code: string;
  message: string;
  /** The underlying error, when there is one (e.g. what the factory threw). */
  cause?: unknown;
}

/** A parsed inbound frame: any JSON object (arrays and primitives are dropped). */
export type SocketFrame = { type?: unknown } & Record<string, unknown>;

export interface ResilientSocketOptions {
  /** Full ws(s):// URL of the endpoint (see {@link toWsUrl}). */
  url: string;
  /** Appended as `?api_key=` (or `&api_key=`) when set — browsers cannot set WS headers. */
  apiKey?: string;
  /**
   * Capped backoff schedule. The attempt counter resets once the server sends
   * a frame on a new connection (not merely on open), so a server that
   * accepts and then immediately closes is still backed off. Default
   * [1000, 2000, 4000, 8000, 15000].
   */
  reconnectDelaysMs?: number[];
  /**
   * Adds a uniformly random 0..jitterMs to every reconnect delay, so many
   * clients dropped at once do not reconnect in lockstep. Default 0 (none).
   */
  jitterMs?: number;
  /** Client `{"type":"ping"}` period while connected. Default 15000. */
  pingIntervalMs?: number;
  /**
   * If no inbound frame (of any kind) arrives within this window after a
   * ping, the socket is considered dead: it is dropped and a reconnect is
   * scheduled. Default 10000.
   */
  pongTimeoutMs?: number;
  /** Injectable for tests / Node consumers. Default: `globalThis.WebSocket`. */
  webSocketFactory?: WebSocketFactory;
  /** Name used in error messages and console warnings. Default `'ResilientSocket'`. */
  label?: string;
  /**
   * Close codes after which the socket stops (status `closed`, `onError`
   * with `ws_terminal_close`) instead of reconnecting. Default `[1008]`
   * (policy violation — Canopy's "invalid API key", and "API key is not
   * scoped to this module", reason `insufficient_module_access: ...`).
   *
   * Only non-browser clients ever see these: a browser reports a rejected
   * handshake as 1006 with no reason, which is never terminal. Browser apps
   * detect auth failure through REST (401 `invalid_api_key`, or 403
   * `insufficient_module_access` for a key not scoped to that module),
   * probed on the same module the socket connects to, and call `close()` /
   * `connect()` themselves. A key that works for one module's REST API can
   * still be refused by another module's socket.
   */
  terminalCloseCodes?: number[];
  /**
   * The socket opened. (Re)subscribe here — it runs on every (re)connect,
   * with the status already `connected`. `send` is {@link ResilientSocket.send}.
   */
  onOpen(send: (msg: unknown) => boolean): void;
  /** Every inbound frame that parses as a JSON object, in arrival order. */
  onFrame(frame: SocketFrame): void;
  /**
   * The current socket closed on its own (network drop, server close, pong
   * timeout) — drop per-socket state such as reply correlation here. Called
   * after the status changed. Not called for an explicit `close()`.
   */
  onClose?(info: SocketCloseInfo): void;
  /** Fires exactly when the status value changes. */
  onStatusChange?(status: SocketStatus): void;
  /** Connection-level errors. Default: `console.warn`. */
  onError?(error: SocketError): void;
}

// A WebSocket is OPEN when readyState === 1 and CONNECTING when 0, in both the
// browser and Node implementations (WHATWG-standardized numeric values). We
// avoid `WebSocket.OPEN` since that needs a concrete WebSocket type.
const WS_CONNECTING = 0;
const WS_OPEN = 1;

const DEFAULT_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const DEFAULT_PING_INTERVAL_MS = 15000;
const DEFAULT_PONG_TIMEOUT_MS = 10000;
const DEFAULT_TERMINAL_CLOSE_CODES = [1008];

function defaultWebSocketFactory(): WebSocketFactory | undefined {
  const ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  return ctor ? (url: string) => new ctor(url) : undefined;
}

// ── Helpers shared with the protocol services in this package ──────────────
// (Exported for HarePVService / FoxFormulaService; not re-exported from the
// package root.)

/** `err.message` for an Error, else `String(err)`. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The status a protocol service reports for a socket status: a stopped
 * socket ('closed') reads as 'disconnected', the status Hare and Fox have
 * always used for both drops and an explicit disconnect.
 */
export function toServiceStatus(status: SocketStatus): Exclude<SocketStatus, 'closed'> {
  return status === 'closed' ? 'disconnected' : status;
}

/**
 * The message a protocol service reports for a socket error:
 * `ws_connect_failed` names the service's connection ("Could not open live
 * connection: ..."); any other error keeps the socket's own message.
 */
export function describeSocketError(error: SocketError, connection: string): string {
  return error.code === 'ws_connect_failed'
    ? `Could not open ${connection} connection: ${errorMessage(error.cause)}`
    : error.message;
}

/**
 * A JSON WebSocket that keeps itself connected.
 *
 * - `connect()` opens the socket (idempotent; supersedes a pending backoff
 *   timer). On every open, `onOpen(send)` runs so the caller can
 *   (re)subscribe.
 * - A drop schedules a reconnect on the capped backoff schedule (plus
 *   optional jitter), which restarts once a connection receives a frame; a
 *   terminal close code stops instead.
 * - While open, `{"type":"ping"}` goes out every `pingIntervalMs`; if nothing
 *   at all arrives within `pongTimeoutMs` of a ping, the socket is dropped
 *   and reconnected.
 * - Events from a socket that has since been replaced or dropped are
 *   ignored, so a late close/open can never clobber the current connection.
 *
 * Framework- and environment-agnostic: the `WebSocket` is injectable.
 */
export class ResilientSocket {
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly reconnectDelaysMs: number[];
  private readonly jitterMs: number;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly webSocketFactory: WebSocketFactory | undefined;
  private readonly label: string;
  private readonly terminalCloseCodes: number[];
  private readonly options: ResilientSocketOptions;

  private socket: WebSocketLike | null = null;
  private desiredConnected = false;
  private _status: SocketStatus = 'idle';
  private reconnectAttempt = 0;
  /** Bumped by every openSocket() call, so a re-entrant one supersedes the outer. */
  private openGeneration = 0;

  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private pongTimer: number | undefined;

  constructor(options: ResilientSocketOptions) {
    this.options = options;
    this.url = options.url;
    this.apiKey = options.apiKey;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    this.jitterMs = Math.max(0, options.jitterMs ?? 0);
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.pongTimeoutMs = options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory();
    this.label = options.label ?? 'ResilientSocket';
    this.terminalCloseCodes = options.terminalCloseCodes ?? DEFAULT_TERMINAL_CLOSE_CODES;
  }

  get status(): SocketStatus {
    return this._status;
  }

  /** Open the socket and keep it open. Idempotent while open or connecting. */
  connect(): void {
    this.desiredConnected = true;
    // An explicit connect supersedes any pending backoff timer; otherwise the
    // timer could fire later and open a second, orphaned socket.
    this.clearReconnectTimer();
    if (
      this.socket &&
      (this.socket.readyState === WS_OPEN || this.socket.readyState === WS_CONNECTING)
    ) {
      return;
    }
    this.openSocket();
  }

  /** Close the socket and stop reconnecting (status `closed`). `onClose` is not called. */
  close(): void {
    this.desiredConnected = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      detach(socket);
      socket.close();
    }
    this.setStatus('closed');
  }

  /** JSON-serialize and send `msg`. Returns false (and sends nothing) unless the socket is OPEN. */
  send(msg: unknown): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WS_OPEN) return false;
    socket.send(JSON.stringify(msg));
    return true;
  }

  // ── Socket lifecycle ──────────────────────────────────────────────────────

  private openSocket(): void {
    const factory = this.webSocketFactory;
    if (!factory) {
      throw new Error(
        `${this.label}.connect: no WebSocket implementation available (inject \`webSocketFactory\` or run in an environment with global WebSocket).`
      );
    }

    const generation = ++this.openGeneration;
    this.setStatus('connecting');
    // A status listener may have called close() (stop) or connect() (which
    // already opened a socket) while it was being told 'connecting'.
    if (!this.desiredConnected || generation !== this.openGeneration) return;

    const wsUrl = this.apiKey
      ? `${this.url}${this.url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(this.apiKey)}`
      : this.url;

    let socket: WebSocketLike;
    try {
      socket = factory(wsUrl);
    } catch (err) {
      this.setStatus('disconnected');
      this.reportError({
        code: 'ws_connect_failed',
        message: `Could not open ${this.label} connection: ${errorMessage(err)}`,
        cause: err,
      });
      if (this.desiredConnected) {
        this.scheduleReconnect();
      }
      return;
    }
    this.socket = socket;

    // Every handler ignores events from a socket we have since replaced or
    // dropped, so a late close/open from an orphaned socket cannot clobber
    // the current connection's bookkeeping.
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.setStatus('connected');
      // A status listener may have closed or replaced the socket.
      if (this.socket !== socket) return;
      this.options.onOpen((msg) => this.send(msg));
      if (this.socket !== socket) return;
      this.startHeartbeat();
    };

    socket.onmessage = (ev: { data: unknown }) => {
      if (this.socket !== socket) return;
      this.handleMessage(ev.data);
    };

    socket.onclose = (ev?: WebSocketCloseEventLike) => {
      if (this.socket !== socket) return;
      this.handleSocketClose({ code: ev?.code, reason: ev?.reason });
    };

    socket.onerror = () => {
      // The subsequent onclose (fired by every WebSocket implementation
      // after an error) drives the actual reconnect bookkeeping.
    };
  }

  private handleSocketClose(info: SocketCloseInfo): void {
    this.socket = null;
    this.stopHeartbeat();

    const terminal = info.code !== undefined && this.terminalCloseCodes.includes(info.code);
    if (terminal) {
      this.desiredConnected = false;
      this.clearReconnectTimer();
      this.setStatus('closed');
      this.options.onClose?.(info);
      this.reportError({
        code: 'ws_terminal_close',
        message: `${this.label}: server closed the connection with code ${info.code}${
          info.reason ? ` (${info.reason})` : ''
        }; not reconnecting`,
      });
      return;
    }

    this.setStatus('disconnected');
    this.options.onClose?.(info);
    if (this.desiredConnected) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delays = this.reconnectDelaysMs;
    const base = delays[Math.min(this.reconnectAttempt, delays.length - 1)] ?? 0;
    const jitter = this.jitterMs > 0 ? Math.round(Math.random() * this.jitterMs) : 0;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      // The !socket guard covers a connect() that already opened one while
      // this timer was pending.
      if (this.desiredConnected && !this.socket) {
        this.openSocket();
      }
    }, base + jitter);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  // ── Heartbeat (client ping / pong liveness) ─────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, this.pingIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== undefined) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
    this.disarmPongDeadline();
  }

  private sendPing(): void {
    if (this.send({ type: 'ping' })) {
      this.armPongDeadline();
    }
  }

  private armPongDeadline(): void {
    if (this.pongTimer !== undefined) return; // one deadline in flight at a time
    this.pongTimer = setTimeout(() => {
      this.pongTimer = undefined;
      const socket = this.socket;
      if (!socket) return;
      // No frame arrived in time: treat the connection as dead. Drop it right
      // away rather than waiting for the close handshake, which a dead peer
      // never answers.
      detach(socket);
      socket.close();
      this.handleSocketClose({ reason: 'pong timeout' });
    }, this.pongTimeoutMs);
  }

  private disarmPongDeadline(): void {
    if (this.pongTimer !== undefined) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
  }

  // ── Frames ────────────────────────────────────────────────────────────────

  private handleMessage(raw: unknown): void {
    // Any inbound frame is proof of life, regardless of whether it parses,
    // and proves the connection is usable: restart the backoff schedule.
    this.disarmPongDeadline();
    this.reconnectAttempt = 0;

    if (typeof raw !== 'string') return;
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return; // Malformed frame: ignore.
    }
    if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) return;
    this.options.onFrame(frame as SocketFrame);
  }

  // ── Status / error reporting ──────────────────────────────────────────────

  private setStatus(status: SocketStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.options.onStatusChange?.(status);
  }

  private reportError(error: SocketError): void {
    if (this.options.onError) {
      this.options.onError(error);
    } else {
      console.warn(`[${this.label}] ${error.code}: ${error.message}`);
    }
  }
}

function detach(socket: WebSocketLike): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
}

/** Where a relative base URL is resolved (`globalThis.location` satisfies it). */
export interface WsLocationLike {
  /** e.g. `'https:'` */
  protocol: string;
  /** host[:port], e.g. `'example.org:8443'` */
  host: string;
  /** Used to resolve path-relative bases (`'api'`, `'./api'`). Default `'/'`. */
  pathname?: string;
}

/**
 * Build the ws(s):// URL for `path` on a Canopy deployment.
 *
 * `http:` becomes `ws:` and `https:` becomes `wss:`; a `ws(s):` base is used
 * as-is. A relative or empty `baseUrl` (e.g. a same-origin dev-proxy prefix
 * like `/api/canopy`) is resolved against `loc`, or `globalThis.location`
 * when omitted — the same place `fetch` would resolve it.
 *
 * ```ts
 * toWsUrl('https://canopy.example.org', '/optimization/v1/ws/runs')
 * // 'wss://canopy.example.org/optimization/v1/ws/runs'
 * toWsUrl('/api/canopy', '/hare/v1/ws/pvs', { protocol: 'http:', host: 'localhost:5173' })
 * // 'ws://localhost:5173/api/canopy/hare/v1/ws/pvs'
 * ```
 */
export function toWsUrl(baseUrl: string, path: string, loc?: WsLocationLike): string {
  let base = baseUrl.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(base)) {
    const where = loc ?? (globalThis as { location?: WsLocationLike }).location;
    if (!where) {
      throw new Error(
        `toWsUrl: cannot resolve the relative baseUrl "${baseUrl}" without a location (pass \`loc\`).`
      );
    }
    base = resolveRelative(base, where);
  }
  base = base
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:')
    .replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function resolveRelative(ref: string, loc: WsLocationLike): string {
  if (ref.startsWith('//')) {
    return `${loc.protocol}${ref}`;
  }
  const origin = `${loc.protocol}//${loc.host}`;
  if (ref === '' || ref.startsWith('/')) {
    return `${origin}${ref}`;
  }
  // Path-relative: resolve against the directory of the current page.
  const directory = (loc.pathname ?? '/').replace(/[^/]*$/, '') || '/';
  const segments: string[] = [];
  for (const segment of `${directory}${ref}`.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '.' && segment !== '') segments.push(segment);
  }
  return `${origin}/${segments.join('/')}`;
}
