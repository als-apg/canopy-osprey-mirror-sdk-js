import { AlarmSeverity } from '../alarm.js';
import type { PVData, PVListener, PVService } from '../pv/PVService.js';
import { DISCONNECTED_PV } from '../pv/PVService.js';
import { canopyFetch } from '../rest/canopyFetch.js';
import type {
  HareAlarmSeverity,
  HareBackend,
  HareHeartbeatFrame,
  HareServerFrame,
  PVMetaDTO,
  PVValueDTO,
  PVWriteRequestDTO,
  PVWriteResultDTO,
  PVWriteValue,
} from './types.js';
import { ValueKind } from './types.js';

// ── Environment-agnostic structural types ───────────────────────────────────
//
// No DOM lib, no @types/node: consumers inject their own WebSocket/fetch (or
// we read them off `globalThis` at call time), so this file never names the
// concrete `WebSocket`/`Response` types from either environment.

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type HareConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface HareError {
  code: string;
  message: string;
}

export interface HarePVServiceOptions {
  /** ws(s):// URL of the live endpoint, e.g. wss://host/hare/v1/ws/pvs */
  url: string;
  /** Appended as ?api_key= on the WS URL; sent as X-API-Key on REST writes. */
  apiKey?: string;
  /** Override the REST endpoint base for writes, e.g. https://host/hare/v1/pvs. Default: derived from `url` (ws->http, wss->https, trailing /ws/pvs -> /pvs, query stripped). */
  httpPvsBaseUrl?: string;
  /** Capped backoff schedule; attempt counter resets on successful open. Default [1000, 2000, 4000, 8000, 15000]. */
  reconnectDelaysMs?: number[];
  /** Client ping period while connected. Default 15000. */
  pingIntervalMs?: number;
  /** If no server frame arrives within this window after a ping, the socket is considered dead and closed (triggering reconnect). Default 10000. */
  pongTimeoutMs?: number;
  /** Injectable for tests / Node consumers. Default: globalThis.WebSocket. */
  webSocketFactory?: WebSocketFactory;
  /** Injectable for tests / Node consumers. Default: globalThis.fetch. */
  fetchFn?: FetchLike;
  onError?: (error: HareError) => void;
  onStatusChange?: (status: HareConnectionStatus) => void;
  /** Fired when a heartbeat reports a backend identity different from the last one (the first heartbeat counts). */
  onBackendChange?: (backend: HareBackend) => void;
}

/** Options accepted by {@link HarePVService.write}. */
export interface HareWriteOptions {
  wait?: boolean;
  timeoutS?: number;
}

// A WebSocket is OPEN when readyState === 1 in both the browser and Node
// WebSocket implementations (the WHATWG-standardized numeric readyState
// values). We avoid referencing `WebSocket.OPEN` since that requires a
// concrete WebSocket type we deliberately don't depend on.
const WS_OPEN = 1;

const DEFAULT_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const DEFAULT_PING_INTERVAL_MS = 15000;
const DEFAULT_PONG_TIMEOUT_MS = 10000;

/**
 * Most PV names put in one subscribe/unsubscribe frame. Hare silently
 * truncates a subscribe frame past its `max_pvs_per_message` (5000 by
 * default), so larger batches are split well below that.
 */
const MAX_PVS_PER_FRAME = 1000;

type PendingOpType = 'subscribe' | 'unsubscribe';

interface PendingOp {
  type: PendingOpType;
  pvName: string;
  /** Cleared when a later unsubscribe cancels this subscribe before it was sent. */
  live: boolean;
}

/** Run `fn` after the current synchronous work, before any timer or I/O callback. */
function scheduleMicrotask(fn: () => void): void {
  const qm = (globalThis as { queueMicrotask?: (cb: () => void) => void }).queueMicrotask;
  if (typeof qm === 'function') {
    qm(fn);
  } else {
    void Promise.resolve().then(fn);
  }
}

const SEVERITY_MAP: Record<HareAlarmSeverity, AlarmSeverity> = {
  NO_ALARM: AlarmSeverity.NO_ALARM,
  MINOR: AlarmSeverity.MINOR,
  MAJOR: AlarmSeverity.MAJOR,
  INVALID: AlarmSeverity.INVALID,
};

/** Derive the default REST write base from the WS URL (ws/wss -> http/https, strip query, /ws/pvs -> /pvs). */
function deriveHttpPvsBaseUrl(wsUrl: string): string {
  let base = wsUrl.split('#')[0]!.split('?')[0]!;
  base = base.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
  base = base.replace(/\/ws\/pvs\/?$/i, '/pvs');
  return base;
}

/** Percent-encode each path segment individually so ca://.../pva:// prefixes survive as literal segments. */
function encodePvNameForPath(pvName: string): string {
  return pvName.split('/').map(encodeURIComponent).join('/');
}

function defaultWebSocketFactory(): WebSocketFactory | undefined {
  const ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  return ctor ? (url: string) => new ctor(url) : undefined;
}

function defaultFetchFn(): FetchLike | undefined {
  return (globalThis as { fetch?: FetchLike }).fetch;
}

/**
 * `PVService` implementation over Canopy Hare's live-PV WebSocket
 * (`WS /hare/v1/ws/pvs`) with REST writes (`PUT /hare/v1/pvs/{pv}`).
 *
 * Framework- and environment-agnostic: takes an injectable `WebSocketFactory`
 * / `FetchLike` so it runs unmodified in browsers, Node, and tests.
 */
export class HarePVService implements PVService {
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly httpPvsBaseUrl: string;
  private readonly reconnectDelaysMs: number[];
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly webSocketFactory: WebSocketFactory | undefined;
  private readonly fetchFn: FetchLike | undefined;
  private readonly onErrorCallback: ((error: HareError) => void) | undefined;
  private readonly onStatusChangeCallback: ((status: HareConnectionStatus) => void) | undefined;
  private readonly onBackendChangeCallback: ((backend: HareBackend) => void) | undefined;

  private listeners = new Map<string, Set<PVListener>>();
  private snapshots = new Map<string, PVData>();
  private metas = new Map<string, PVMetaDTO>();

  private socket: WebSocketLike | null = null;
  private desiredConnected = false;
  private _status: HareConnectionStatus = 'idle';
  // Identity from the last heartbeat; kept across disconnects (the link
  // state is reported separately through status).
  private backend: HareBackend | null = null;
  private reconnectAttempt = 0;

  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private pongTimer: number | undefined;

  // Subscribe/unsubscribe ops issued while the socket is open, in call order,
  // flushed as few frames as possible at the end of the current tick (a screen
  // mounting hundreds of widgets in one commit sends one frame, not hundreds).
  // `pendingByName` holds each name's latest pending op.
  private pendingOps: PendingOp[] = [];
  private pendingByName = new Map<string, PendingOp>();
  private flushScheduled = false;

  constructor(options: HarePVServiceOptions) {
    this.url = options.url;
    this.apiKey = options.apiKey;
    this.httpPvsBaseUrl = options.httpPvsBaseUrl ?? deriveHttpPvsBaseUrl(options.url);
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.pongTimeoutMs = options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory();
    this.fetchFn = options.fetchFn ?? defaultFetchFn();
    this.onErrorCallback = options.onError;
    this.onStatusChangeCallback = options.onStatusChange;
    this.onBackendChangeCallback = options.onBackendChange;
  }

  // ── PVService lifecycle ────────────────────────────────────────────────

  get isConnected(): boolean {
    return this._status === 'connected';
  }

  get status(): HareConnectionStatus {
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

  disconnect(): void {
    this.desiredConnected = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    this.clearPending();
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    this.setStatus('disconnected');
    this.markAllDisconnected();
  }

  // ── Subscriptions ───────────────────────────────────────────────────────

  subscribe(pvName: string, listener: PVListener): () => void {
    let set = this.listeners.get(pvName);
    const isFirstListener = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.listeners.set(pvName, set);
    }
    set.add(listener);

    let snapshot = this.snapshots.get(pvName);
    if (!snapshot && this._status === 'disconnected') {
      // The link is down: say so at once instead of leaving the PV silent
      // until the next connect.
      snapshot = disconnectedCopy(DISCONNECTED_PV, undefined);
      this.snapshots.set(pvName, snapshot);
    }
    if (snapshot) {
      listener(snapshot);
    }

    if (isFirstListener && this.socket && this.socket.readyState === WS_OPEN) {
      this.enqueue('subscribe', pvName);
    }

    return () => {
      const subs = this.listeners.get(pvName);
      if (!subs) return;
      subs.delete(listener);
      if (subs.size === 0) {
        this.listeners.delete(pvName);
        this.snapshots.delete(pvName);
        this.metas.delete(pvName);
        if (this.socket && this.socket.readyState === WS_OPEN) {
          this.enqueue('unsubscribe', pvName);
        }
      }
    };
  }

  getSnapshot(pvName: string): PVData | undefined {
    return this.snapshots.get(pvName);
  }

  getMeta(pvName: string): PVMetaDTO | undefined {
    return this.metas.get(pvName);
  }

  /** Backend identity of the last heartbeat received, or null before the first one. */
  getBackend(): HareBackend | null {
    return this.backend ? { ...this.backend } : null;
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  put(pvName: string, value: number | string | boolean): void {
    this.write(pvName, value).catch((err: unknown) => {
      this.reportError({ code: 'write_failed', message: errorMessage(err) });
    });
  }

  async write(pvName: string, value: PVWriteValue, options?: HareWriteOptions): Promise<void> {
    const fetchFn = this.fetchFn;
    if (!fetchFn) {
      throw new Error(
        'HarePVService.write: no fetch implementation available (inject `fetchFn` or run in an environment with global fetch).'
      );
    }

    const body: PVWriteRequestDTO = { value };
    if (options?.wait !== undefined) {
      body.wait = options.wait;
    }
    if (options?.timeoutS !== undefined) {
      body.timeout = options.timeoutS;
    }

    // Failures surface as CanopyError carrying the backend's {code, detail}
    // envelope (see ../rest/canopyFetch.ts).
    await canopyFetch<PVWriteResultDTO | undefined>(
      { baseUrl: this.httpPvsBaseUrl, apiKey: this.apiKey, fetch: fetchFn },
      `/${encodePvNameForPath(pvName)}`,
      { method: 'PUT', body }
    );
  }

  // ── Socket lifecycle ────────────────────────────────────────────────────

  private openSocket(): void {
    const factory = this.webSocketFactory;
    if (!factory) {
      throw new Error(
        'HarePVService.connect: no WebSocket implementation available (inject `webSocketFactory` or run in an environment with global WebSocket).'
      );
    }

    this.setStatus('connecting');
    // Ops queued for a previous socket are void: the new socket's open
    // resubscribes every PV that still has listeners.
    this.clearPending();

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
        message: `Could not open live connection: ${errorMessage(err)}`,
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
      // after an error) drives the actual reconnect/disconnect bookkeeping.
    };
  }

  private handleSocketClose(): void {
    this.socket = null;
    this.clearPending();
    this.stopHeartbeat();
    this.setStatus('disconnected');
    this.markAllDisconnected();

    if (this.desiredConnected) {
      this.scheduleReconnect();
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

  private resubscribeAll(): void {
    const pvNames = [...this.listeners.keys()];
    if (pvNames.length > 0) {
      this.sendSubscribe(pvNames);
    }
  }

  private markAllDisconnected(): void {
    // The server re-describes every PV on the next subscribe.
    this.metas.clear();
    for (const pvName of this.listeners.keys()) {
      const previous = this.snapshots.get(pvName);
      const data = disconnectedCopy(previous ?? DISCONNECTED_PV, previous?.valueKind);
      this.snapshots.set(pvName, data);
      this.notify(pvName, data);
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

  // ── Frame handling ──────────────────────────────────────────────────────

  private handleMessage(raw: unknown): void {
    // Any inbound frame is proof of life, regardless of whether it parses.
    this.disarmPongDeadline();

    if (typeof raw !== 'string') return;
    let frame: HareServerFrame;
    try {
      frame = JSON.parse(raw) as HareServerFrame;
    } catch {
      return; // Malformed frame: ignore.
    }

    switch (frame.type) {
      case 'initial':
        for (const [pvName, meta] of Object.entries(frame.meta)) {
          // Gate on listeners like applyValue does, so a stray initial for an
          // already-unsubscribed PV cannot park meta in the cache forever.
          if (this.listeners.has(pvName)) {
            this.metas.set(pvName, meta);
          }
        }
        for (const [pvName, dto] of Object.entries(frame.data)) {
          this.applyValue(pvName, dto);
        }
        break;
      case 'diff':
        for (const [pvName, dto] of Object.entries(frame.data)) {
          this.applyValue(pvName, dto);
        }
        break;
      case 'error':
        this.reportError({ code: frame.code, message: frame.message });
        break;
      case 'heartbeat':
        this.applyHeartbeat(frame);
        break;
      case 'pong':
        // Liveness only; already handled above.
        break;
    }
  }

  private applyHeartbeat(frame: HareHeartbeatFrame): void {
    // Older servers send only `backend`; their missing fields read as null.
    const next: HareBackend = {
      name: frame.backend ?? null,
      label: frame.label ?? null,
      notice: frame.notice ?? null,
      binding: frame.binding ?? null,
    };
    const prev = this.backend;
    if (
      prev &&
      prev.name === next.name &&
      prev.label === next.label &&
      prev.notice === next.notice &&
      prev.binding === next.binding
    ) {
      return;
    }
    this.backend = next;
    this.onBackendChangeCallback?.({ ...next });
  }

  private applyValue(pvName: string, dto: PVValueDTO): void {
    if (!this.listeners.has(pvName)) {
      // Stray frame for a PV nobody is listening to anymore (e.g. an
      // in-flight diff that arrived just after the last unsubscribe).
      return;
    }

    const meta = this.metas.get(pvName);
    const connected = dto.connected !== false;
    // Fall back to INVALID if the server ever grows a severity we don't know.
    const severity = connected
      ? (SEVERITY_MAP[dto.severity] ?? AlarmSeverity.INVALID)
      : AlarmSeverity.DISCONNECTED;

    const fresh: PVData = {
      value: toPVDataValue(dto.value),
      displayValue: formatDisplayValue(dto, meta),
      severity,
      connected,
      timestamp: Math.floor(dto.tsNs / 1e6),
      units: meta?.units ?? '',
      precision: meta?.precision ?? 0,
      lowerLimit: meta?.displayLow ?? 0,
      upperLimit: meta?.displayHigh ?? 0,
      enumChoices: meta?.enumChoices ?? undefined,
      valueKind: dto.valueKind,
    };
    const data = connected
      ? fresh
      : disconnectedCopy(fresh, this.snapshots.get(pvName)?.valueKind ?? dto.valueKind);

    this.snapshots.set(pvName, data);
    this.notify(pvName, data);
  }

  private notify(pvName: string, data: PVData): void {
    const subs = this.listeners.get(pvName);
    if (!subs) return;
    for (const listener of subs) {
      listener(data);
    }
  }

  // ── Outbound messages ───────────────────────────────────────────────────

  private enqueue(type: PendingOpType, pvName: string): void {
    const latest = this.pendingByName.get(pvName);
    if (type === 'unsubscribe' && latest?.type === 'subscribe') {
      // A subscribe is only issued when the PV had no listeners, so the server
      // does not hold it; dropping the unsent subscribe together with this
      // unsubscribe leaves the server exactly where both frames would.
      latest.live = false;
      this.pendingByName.delete(pvName);
      return;
    }
    const op: PendingOp = { type, pvName, live: true };
    this.pendingOps.push(op);
    this.pendingByName.set(pvName, op);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      scheduleMicrotask(() => this.flushPending());
    }
  }

  private clearPending(): void {
    this.pendingOps = [];
    this.pendingByName.clear();
  }

  /**
   * Send the pending ops in call order, one frame per run of consecutive
   * same-type ops (Hare applies frames strictly in arrival order, so a run
   * never crosses an op of the other type).
   */
  private flushPending(): void {
    this.flushScheduled = false;
    const ops = this.pendingOps;
    this.clearPending();
    const socket = this.socket;
    // Not open (closed or replaced since enqueue): the reconnect's
    // resubscribeAll covers every PV that still has listeners.
    if (!socket || socket.readyState !== WS_OPEN) return;

    let runType: PendingOpType | null = null;
    let run: string[] = [];
    let seen = new Set<string>();
    const emit = () => {
      if (runType && run.length > 0) this.sendFrames(runType, run);
    };
    for (const op of ops) {
      if (!op.live) continue;
      if (op.type !== runType) {
        emit();
        runType = op.type;
        run = [];
        seen = new Set();
      }
      if (!seen.has(op.pvName)) {
        seen.add(op.pvName);
        run.push(op.pvName);
      }
    }
    emit();
  }

  private sendSubscribe(pvNames: string[]): void {
    this.sendFrames('subscribe', pvNames);
  }

  private sendFrames(type: PendingOpType, pvNames: string[]): void {
    const socket = this.socket;
    if (!socket) return;
    for (let i = 0; i < pvNames.length; i += MAX_PVS_PER_FRAME) {
      socket.send(JSON.stringify({ type, pvNames: pvNames.slice(i, i + MAX_PVS_PER_FRAME) }));
    }
  }

  // ── Status / error reporting ────────────────────────────────────────────

  private setStatus(status: HareConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.onStatusChangeCallback?.(status);
  }

  private reportError(error: HareError): void {
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    } else {
      console.warn(`[HarePVService] ${error.code}: ${error.message}`);
    }
  }
}

// ── Value / display formatting helpers ──────────────────────────────────────

/**
 * A disconnected copy of `base`: `connected: false`, DISCONNECTED severity,
 * `displayValue` `''` and the empty value of `kind` (waveform `[]`, string
 * `''`, table with no labels or columns, anything else `0`). The last value is
 * never carried over. `kind` becomes the copy's `valueKind`; when it is
 * undefined the copy has no `valueKind` key at all ("unknown"). Other fields
 * (units, limits, timestamp …) come from `base`.
 */
function disconnectedCopy(base: PVData, kind: ValueKind | undefined): PVData {
  const copy: PVData = {
    ...base,
    value: emptyValueOf(kind),
    displayValue: '',
    connected: false,
    severity: AlarmSeverity.DISCONNECTED,
  };
  if (kind === undefined) {
    delete copy.valueKind;
  } else {
    copy.valueKind = kind;
  }
  return copy;
}

function emptyValueOf(kind: ValueKind | undefined): PVData['value'] {
  switch (kind) {
    case ValueKind.WAVEFORM:
      return [];
    case ValueKind.STRING:
      return '';
    case ValueKind.TABLE:
      return { labels: [], columns: [] };
    default:
      return 0;
  }
}

function toPVDataValue(value: PVValueDTO['value']): PVData['value'] {
  if (value === null) return 0;
  return value as PVData['value'];
}

function isTableValue(
  value: PVValueDTO['value']
): value is { labels: string[]; columns: unknown[][] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'labels' in value &&
    'columns' in value
  );
}

function formatDisplayValue(dto: PVValueDTO, meta: PVMetaDTO | undefined): string {
  const { value } = dto;

  // connected:false frames never get here: applyValue makes a disconnected copy.
  if (value === null) {
    return '---';
  }

  if (dto.valueKind === ValueKind.ENUM && typeof value === 'number') {
    const label = meta?.enumChoices?.[value];
    if (label !== undefined) {
      return label;
    }
  }

  if (typeof value === 'number') {
    const formatted = meta?.precision != null ? value.toFixed(meta.precision) : String(value);
    return meta?.units ? `${formatted} ${meta.units}` : formatted;
  }

  if (typeof value === 'boolean' || typeof value === 'string') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `waveform[${value.length}]`;
  }

  if (isTableValue(value)) {
    const rowCount = value.columns[0]?.length ?? 0;
    return `table[${rowCount}x${value.labels.length}]`;
  }

  return String(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
