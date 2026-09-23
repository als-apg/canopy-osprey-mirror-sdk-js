import type { WebSocketFactory } from '../transport.js';
import { ResilientSocket } from '../ws/ResilientSocket.js';
import type { SocketError, SocketFrame, SocketStatus } from '../ws/ResilientSocket.js';
import type { FormulaResultDTO, FormulaSpec, FoxServerFrame } from './types.js';

export type FoxConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface FoxError {
  code: string;
  message: string;
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

/** Derive the formulas WS endpoint from the API base URL (http(s) -> ws(s)). */
function deriveFormulasWsUrl(baseUrl: string): string {
  let base = baseUrl.replace(/\/+$/, '');
  base = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${base}/fox/v1/ws/formulas`;
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
 * `WebSocketFactory`; the connection (capped-backoff reconnect, ping/pong
 * liveness) is a {@link ResilientSocket}, as for `HarePVService`.
 */
export class FoxFormulaService {
  private readonly onErrorCallback: ((error: FoxError) => void) | undefined;
  private readonly onStatusChangeCallback: ((status: FoxConnectionStatus) => void) | undefined;
  private readonly socket: ResilientSocket;

  /** Every live local subscription, in subscribe order. */
  private subscriptions = new Set<LocalSubscription>();
  /** Subscribe frames sent on the current socket, awaiting `subscribed` replies (FIFO). */
  private pending: LocalSubscription[] = [];
  private byServerId = new Map<string, LocalSubscription>();

  private _status: FoxConnectionStatus = 'idle';

  constructor(options: FoxFormulaServiceOptions) {
    this.onErrorCallback = options.onError;
    this.onStatusChangeCallback = options.onStatusChange;
    this.socket = new ResilientSocket({
      url: options.wsUrl ?? deriveFormulasWsUrl(options.baseUrl),
      apiKey: options.apiKey,
      reconnectDelaysMs: options.reconnectDelaysMs,
      pingIntervalMs: options.pingIntervalMs,
      pongTimeoutMs: options.pongTimeoutMs,
      webSocketFactory: options.webSocketFactory,
      terminalCloseCodes: [],
      label: 'FoxFormulaService',
      onOpen: () => this.resubscribeAll(),
      onFrame: (frame) => this.handleFrame(frame),
      // Server-assigned ids die with their socket.
      onClose: () => this.resetServerCorrelation(),
      onStatusChange: (status) => this.handleSocketStatus(status),
      onError: (error) => this.handleSocketError(error),
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this._status === 'connected';
  }

  get status(): FoxConnectionStatus {
    return this._status;
  }

  connect(): void {
    this.socket.connect();
  }

  /**
   * Close the connection and stop reconnecting. Held subscriptions are kept:
   * a later `connect()` re-subscribes them (server ids are re-assigned and
   * remapped, exactly as on an automatic reconnect).
   */
  dispose(): void {
    this.resetServerCorrelation();
    this.socket.close();
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

    // Sent only while the socket is open; otherwise the next open re-sends
    // every held subscription.
    this.sendSubscribe(sub);

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
      this.socket.send({ type: 'unsubscribe', id: sub.serverId });
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

  // ── Connection callbacks ──────────────────────────────────────────────────

  private handleSocketStatus(status: SocketStatus): void {
    // A stopped socket ('closed') is reported as 'disconnected', the status
    // this service has always used for both drops and dispose().
    this.setStatus(status === 'closed' ? 'disconnected' : status);
  }

  private handleSocketError(error: SocketError): void {
    if (error.code === 'ws_connect_failed') {
      this.reportError({
        code: error.code,
        message: `Could not open formula connection: ${errorMessage(error.cause)}`,
      });
      return;
    }
    this.reportError({ code: error.code, message: error.message });
  }

  /** Server-assigned ids die with their socket; forget all reply correlation. */
  private resetServerCorrelation(): void {
    this.pending = [];
    this.byServerId.clear();
    for (const sub of this.subscriptions) {
      sub.serverId = null;
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

  // ── Frame handling ────────────────────────────────────────────────────────

  private handleFrame(raw: SocketFrame): void {
    const frame = raw as unknown as FoxServerFrame;
    switch (frame.type) {
      case 'subscribed':
        this.handleSubscribed(frame.id);
        break;
      case 'result': {
        const sub = this.byServerId.get(frame.id);
        // Unknown id: a frame that raced our unsubscribe. Drop it.
        sub?.onResult(frame.data);
        break;
      }
      case 'completed':
        // A fixed-window (t1Ns != 0) evaluation finished. The local
        // subscription stays held until the caller unsubscribes.
        break;
      case 'error':
        this.handleErrorFrame(frame.id, { code: frame.code, message: frame.message });
        break;
      case 'pong':
        // Liveness only (the socket already counted it).
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
      this.socket.send({ type: 'unsubscribe', id: serverId });
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
    // JSON.stringify drops undefined members, so omitted options fall back
    // to the server-side defaults.
    const sent = this.socket.send({
      type: 'subscribe',
      spec: sub.spec,
      t0Ns: sub.t0Ns,
      t1Ns: sub.t1Ns,
      intervalMs: sub.intervalMs,
    });
    if (sent) {
      this.pending.push(sub);
    }
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
