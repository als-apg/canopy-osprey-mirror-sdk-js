import type { WebSocketFactory, WebSocketLike } from '../hare/HarePVService.js';
import type { FormulaResultDTO, FormulaSpec, FoxServerFrame, TableInputDTO } from './types.js';

export type FoxConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface FoxError {
  code: string;
  message: string;
  /**
   * True when the condition is transient and the subscription stays live
   * (the server keeps evaluating, or the service reconnects); false for a
   * terminal reject. A server frame without the flag reads as false.
   */
  retryable: boolean;
}

export interface FoxFormulaServiceOptions {
  /**
   * Base URL of the Canopy API, e.g. `https://canopy.example.org` — the
   * service connects to `{baseUrl}/fox/v1/ws/formulas` (http(s) is switched
   * to ws(s); a ws(s) base is used as-is).
   */
  baseUrl: string;
  /** Appended as `?api_key=` on the WS URL. */
  apiKey?: string;
  /** Override the full WS endpoint URL (skips derivation from `baseUrl`). */
  wsUrl?: string;
  /** Capped backoff schedule; attempt counter resets on successful open. Default [1000, 2000, 4000, 8000, 15000]. */
  reconnectDelaysMs?: number[];
  /** Client ping period while connected. Default 15000. */
  pingIntervalMs?: number;
  /** If no server frame arrives within this window after a ping, the socket is considered dead and closed (triggering reconnect). Default 10000. */
  pongTimeoutMs?: number;
  /** Injectable for tests / Node consumers. Default: globalThis.WebSocket. */
  webSocketFactory?: WebSocketFactory;
  /** Connection-level errors and error frames that match no subscription. */
  onError?: (error: FoxError) => void;
  onStatusChange?: (status: FoxConnectionStatus) => void;
}

/** Options accepted by {@link FoxFormulaService.subscribe}. */
export interface FoxSubscribeOptions {
  /** Window start (epoch ns). Omitted = server default 0. */
  t0Ns?: number;
  /**
   * Window end (epoch ns). Omitted/0 = live subscription (re-evaluated on
   * input changes). Non-zero = fixed historical window: the server sends one
   * result and a `completed` frame (and will re-evaluate once per reconnect
   * while the subscription is held).
   */
  t1Ns?: number;
  /** When > 0, the server re-evaluates on this timer instead of on PV change. */
  intervalMs?: number;
  onResult: (data: FormulaResultDTO) => void;
  /** Errors scoped to this subscription. Falls back to the service-level onError. */
  onError?: (error: FoxError) => void;
}

interface LocalSubscription {
  spec: FormulaSpec;
  t0Ns: number | undefined;
  t1Ns: number | undefined;
  intervalMs: number | undefined;
  onResult: (data: FormulaResultDTO) => void;
  onError: ((error: FoxError) => void) | undefined;
  /** Server-assigned id on the *current* socket; null while (re)subscribing. */
  serverId: string | null;
  /** Set when the caller unsubscribed while the subscribe was still in flight. */
  unsubscribed: boolean;
}

const WS_OPEN = 1;

const DEFAULT_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const DEFAULT_PING_INTERVAL_MS = 15000;
const DEFAULT_PONG_TIMEOUT_MS = 10000;

/** Derive the formulas WS endpoint from the API base URL (http(s) -> ws(s)). */
function deriveFormulasWsUrl(baseUrl: string): string {
  let base = baseUrl.replace(/\/+$/, '');
  base = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${base}/fox/v1/ws/formulas`;
}

function defaultWebSocketFactory(): WebSocketFactory | undefined {
  const ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  return ctor ? (url: string) => new ctor(url) : undefined;
}

/**
 * Live formula evaluation over Canopy Fox's WebSocket
 * (`WS /fox/v1/ws/formulas`). Knows `FormulaSpec` only — naming conventions
 * and screen-level rule types live in the consuming apps.
 *
 * Subscription ids are **server-assigned**: each `subscribe` frame is
 * answered (in order) by a `subscribed` frame carrying the id used on all
 * later `result`/`error` frames. The service correlates replies to local
 * subscriptions through a FIFO queue, so after a reconnect it re-sends every
 * held subscription and transparently remaps the freshly assigned ids onto
 * the existing callbacks.
 *
 * Framework- and environment-agnostic: takes an injectable
 * `WebSocketFactory`, reconnects with the same capped backoff and ping/pong
 * liveness scheme as `HarePVService`.
 */
export class FoxFormulaService {
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly reconnectDelaysMs: number[];
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly webSocketFactory: WebSocketFactory | undefined;
  private readonly onErrorCallback: ((error: FoxError) => void) | undefined;
  private readonly onStatusChangeCallback: ((status: FoxConnectionStatus) => void) | undefined;

  /** Every live local subscription, in subscribe order. */
  private subscriptions = new Set<LocalSubscription>();
  /** Subscribe frames sent on the current socket, awaiting `subscribed` replies (FIFO). */
  private pending: LocalSubscription[] = [];
  private byServerId = new Map<string, LocalSubscription>();

  private socket: WebSocketLike | null = null;
  private desiredConnected = false;
  private _status: FoxConnectionStatus = 'idle';
  private reconnectAttempt = 0;

  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private pongTimer: number | undefined;

  constructor(options: FoxFormulaServiceOptions) {
    this.url = options.wsUrl ?? deriveFormulasWsUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.pongTimeoutMs = options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory();
    this.onErrorCallback = options.onError;
    this.onStatusChangeCallback = options.onStatusChange;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this._status === 'connected';
  }

  get status(): FoxConnectionStatus {
    return this._status;
  }

  connect(): void {
    this.desiredConnected = true;
    // An explicit connect supersedes any pending backoff timer; otherwise the
    // timer could fire later and open a second, orphaned socket.
    this.clearReconnectTimer();
    if (this.socket && (this.socket.readyState === WS_OPEN || this.socket.readyState === 0)) {
      // Already open or connecting.
      return;
    }
    this.openSocket();
  }

  /**
   * Close the connection and stop reconnecting. Held subscriptions are kept:
   * a later `connect()` re-subscribes them (server ids are re-assigned and
   * remapped, exactly as on an automatic reconnect).
   */
  dispose(): void {
    this.desiredConnected = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.resetServerCorrelation();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    this.setStatus('disconnected');
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  /**
   * Subscribe to live evaluations of `spec`. Returns an idempotent
   * unsubscribe function. May be called before `connect()` or while
   * disconnected — the subscription is (re)sent whenever a socket opens.
   */
  subscribe(spec: FormulaSpec, opts: FoxSubscribeOptions): () => void {
    const sub: LocalSubscription = {
      spec,
      t0Ns: opts.t0Ns,
      t1Ns: opts.t1Ns,
      intervalMs: opts.intervalMs,
      onResult: opts.onResult,
      onError: opts.onError,
      serverId: null,
      unsubscribed: false,
    };
    this.subscriptions.add(sub);

    if (this.socket && this.socket.readyState === WS_OPEN) {
      this.sendSubscribe(sub);
    }

    return () => {
      this.unsubscribe(sub);
    };
  }

  private unsubscribe(sub: LocalSubscription): void {
    if (!this.subscriptions.delete(sub)) {
      return; // Already unsubscribed (or dropped after a server-side reject).
    }

    if (sub.serverId !== null) {
      this.byServerId.delete(sub.serverId);
      if (this.socket && this.socket.readyState === WS_OPEN) {
        this.socket.send(JSON.stringify({ type: 'unsubscribe', id: sub.serverId }));
      }
      sub.serverId = null;
      return;
    }

    // No server id yet. If a subscribe frame is in flight, remember the
    // intent: the sub must stay in the pending queue (its slot keeps the
    // FIFO reply correlation aligned) and is unsubscribed server-side the
    // moment its `subscribed` frame arrives.
    if (this.pending.includes(sub)) {
      sub.unsubscribed = true;
    }
  }

  // ── Socket lifecycle ──────────────────────────────────────────────────────

  private openSocket(): void {
    const factory = this.webSocketFactory;
    if (!factory) {
      throw new Error(
        'FoxFormulaService.connect: no WebSocket implementation available (inject `webSocketFactory` or run in an environment with global WebSocket).'
      );
    }

    this.setStatus('connecting');

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
        message: `Could not open formula connection: ${errorMessage(err)}`,
        // The service schedules a reconnect while connection is desired.
        retryable: true,
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
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      this.resubscribeAll();
      this.startHeartbeat();
    };

    socket.onmessage = (ev: { data: unknown }) => {
      if (this.socket !== socket) return;
      this.handleMessage(ev.data);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.handleSocketClose();
    };

    socket.onerror = () => {
      // The subsequent onclose (fired by every WebSocket implementation
      // after an error) drives the actual reconnect/dispose bookkeeping.
    };
  }

  private handleSocketClose(): void {
    this.socket = null;
    this.stopHeartbeat();
    this.resetServerCorrelation();
    this.setStatus('disconnected');

    // Every held subscription loses its live evaluation with the socket. Tell
    // each one, so a consumer stops presenting its last result as current;
    // retryable because the subscription is kept and re-sent on reconnect.
    // dispose() detaches onclose first, so a deliberate close stays silent.
    // Iterate a copy: a callback may unsubscribe.
    for (const sub of [...this.subscriptions]) {
      if (!this.subscriptions.has(sub)) continue;
      this.dispatchSubscriptionError(sub, {
        code: 'ws_disconnected',
        message: 'Formula connection lost.',
        retryable: true,
      });
    }

    if (this.desiredConnected) {
      this.scheduleReconnect();
    }
  }

  /** Server-assigned ids die with their socket; forget all reply correlation. */
  private resetServerCorrelation(): void {
    this.pending = [];
    this.byServerId.clear();
    for (const sub of this.subscriptions) {
      sub.serverId = null;
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delays = this.reconnectDelaysMs;
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)] ?? 0;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      // The !socket guard covers a connect() that already opened one while
      // this timer was pending.
      if (this.desiredConnected && !this.socket) {
        this.openSocket();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  /**
   * Re-send a subscribe frame for every held subscription. The server
   * assigns *new* ids; the `subscribed` replies arrive in send order and are
   * remapped onto these local subscriptions through the pending FIFO.
   */
  private resubscribeAll(): void {
    for (const sub of this.subscriptions) {
      this.sendSubscribe(sub);
    }
  }

  // ── Heartbeat (client ping / pong liveness) ───────────────────────────────

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
    const socket = this.socket;
    if (!socket || socket.readyState !== WS_OPEN) return;
    socket.send(JSON.stringify({ type: 'ping' }));
    this.armPongDeadline();
  }

  private armPongDeadline(): void {
    if (this.pongTimer !== undefined) return; // one deadline in flight at a time
    this.pongTimer = setTimeout(() => {
      this.pongTimer = undefined;
      // No server frame arrived in time: treat the connection as dead.
      // Closing triggers the normal onclose -> reconnect path.
      const socket = this.socket;
      if (socket) {
        socket.close();
      }
    }, this.pongTimeoutMs);
  }

  private disarmPongDeadline(): void {
    if (this.pongTimer !== undefined) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
  }

  // ── Frame handling ────────────────────────────────────────────────────────

  private handleMessage(raw: unknown): void {
    // Any inbound frame is proof of life, regardless of whether it parses.
    this.disarmPongDeadline();

    if (typeof raw !== 'string') return;
    let frame: FoxServerFrame;
    try {
      frame = JSON.parse(raw) as FoxServerFrame;
    } catch {
      return; // Malformed frame: ignore.
    }

    switch (frame.type) {
      case 'subscribed':
        this.handleSubscribed(frame.id);
        break;
      case 'result': {
        const sub = this.byServerId.get(frame.id);
        // Unknown id: a frame that raced our unsubscribe. Drop it.
        sub?.onResult(normalizeResult(frame.data));
        break;
      }
      case 'completed':
        // A fixed-window (t1Ns != 0) evaluation finished. The local
        // subscription stays held until the caller unsubscribes.
        break;
      case 'error':
        this.handleErrorFrame(frame.id, {
          code: frame.code,
          message: frame.message,
          retryable: frame.retryable ?? false,
        });
        break;
      case 'pong':
        // Liveness only; already handled above.
        break;
    }
  }

  private handleSubscribed(serverId: string): void {
    // Replies arrive in the order the subscribe frames were sent, so this
    // acknowledges the oldest in-flight subscribe.
    const sub = this.pending.shift();
    if (!sub) return; // Stray ack (protocol hiccup); nothing to correlate.

    if (sub.unsubscribed) {
      // Unsubscribed while the subscribe was in flight: now that the server
      // id exists, immediately release it.
      this.socket?.send(JSON.stringify({ type: 'unsubscribe', id: serverId }));
      return;
    }

    sub.serverId = serverId;
    this.byServerId.set(serverId, sub);
  }

  private handleErrorFrame(id: string | undefined, error: FoxError): void {
    if (id !== undefined) {
      const sub = this.byServerId.get(id);
      if (sub) {
        this.dispatchSubscriptionError(sub, error);
      }
      // Unknown id: raced an unsubscribe; drop like a stray result.
      return;
    }

    // No id. If a subscribe is in flight this is its (negative) reply — the
    // server sends either `subscribed` or an id-less `error` per subscribe,
    // in order. Drop the subscription for good: retrying an invalid spec on
    // every reconnect would just fail again.
    const sub = this.pending.shift();
    if (sub) {
      this.subscriptions.delete(sub);
      if (!sub.unsubscribed) {
        this.dispatchSubscriptionError(sub, error);
      }
      return;
    }

    this.reportError(error);
  }

  private dispatchSubscriptionError(sub: LocalSubscription, error: FoxError): void {
    if (sub.onError) {
      sub.onError(error);
    } else {
      this.reportError(error);
    }
  }

  // ── Outbound messages ─────────────────────────────────────────────────────

  private sendSubscribe(sub: LocalSubscription): void {
    if (!this.socket) return;
    this.pending.push(sub);
    // JSON.stringify drops undefined members, so omitted options fall back
    // to the server-side defaults.
    this.socket.send(
      JSON.stringify({
        type: 'subscribe',
        spec: sub.spec,
        t0Ns: sub.t0Ns,
        t1Ns: sub.t1Ns,
        intervalMs: sub.intervalMs,
      })
    );
  }

  // ── Status / error reporting ──────────────────────────────────────────────

  private setStatus(status: FoxConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.onStatusChangeCallback?.(status);
  }

  private reportError(error: FoxError): void {
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    } else {
      console.warn(`[FoxFormulaService] ${error.code}: ${error.message}`);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fill wire defaults the server may omit: a `'table'` input without
 * `lateAfterFinal` reads as `false`. Other kinds pass through untouched.
 */
function normalizeResult(data: FormulaResultDTO): FormulaResultDTO {
  const table = data.table;
  if (!table?.inputs) return data;
  const inputs: Record<string, TableInputDTO> = {};
  for (const [binding, input] of Object.entries(table.inputs)) {
    inputs[binding] = { ...input, lateAfterFinal: input.lateAfterFinal ?? false };
  }
  return { ...data, table: { ...table, inputs } };
}
