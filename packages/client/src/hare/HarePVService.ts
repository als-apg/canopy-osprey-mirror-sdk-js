import { AlarmSeverity } from '../alarm.js';
import type { PVData, PVListener, PVService } from '../pv/PVService.js';
import { DISCONNECTED_PV } from '../pv/PVService.js';
import { canopyFetch } from '../rest/canopyFetch.js';
import type { FetchLike, WebSocketFactory } from '../transport.js';
import { ResilientSocket } from '../ws/ResilientSocket.js';
import type { SocketError, SocketFrame, SocketStatus } from '../ws/ResilientSocket.js';
import type {
  HareAlarmSeverity,
  HareServerFrame,
  PVMetaDTO,
  PVValueDTO,
  PVWriteRequestDTO,
  PVWriteResultDTO,
  PVWriteValue,
} from './types.js';
import { ValueKind } from './types.js';

// The structural transport types moved to ../transport.ts; re-exported here
// so existing `from './hare/HarePVService.js'` imports keep working.
export type { FetchLike, WebSocketFactory, WebSocketLike } from '../transport.js';

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
  /** Capped backoff schedule; the attempt counter resets once the server sends a frame on a new connection. Default [1000, 2000, 4000, 8000, 15000]. */
  reconnectDelaysMs?: number[];
  /** Client ping period while connected. Default 15000. */
  pingIntervalMs?: number;
  /** If no server frame arrives within this window after a ping, the socket is considered dead and closed (triggering reconnect). Default 10000. */
  pongTimeoutMs?: number;
  /** Injectable for tests / Node consumers. Default: globalThis.WebSocket. */
  webSocketFactory?: WebSocketFactory;
  /**
   * Close codes after which the service stops reconnecting (status
   * `disconnected`, `onError` with `ws_terminal_close`) until `connect()` is
   * called again. Default `[1008]` (Canopy's "invalid API key"). Browsers
   * report a rejected handshake as 1006, which never stops the service; pass
   * `[]` to always reconnect.
   */
  terminalCloseCodes?: number[];
  /** Injectable for tests / Node consumers. Default: globalThis.fetch. */
  fetchFn?: FetchLike;
  onError?: (error: HareError) => void;
  onStatusChange?: (status: HareConnectionStatus) => void;
}

/** Options accepted by {@link HarePVService.write}. */
export interface HareWriteOptions {
  wait?: boolean;
  timeoutS?: number;
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

function defaultFetchFn(): FetchLike | undefined {
  return (globalThis as { fetch?: FetchLike }).fetch;
}

/**
 * `PVService` implementation over Canopy Hare's live-PV WebSocket
 * (`WS /hare/v1/ws/pvs`) with REST writes (`PUT /hare/v1/pvs/{pv}`).
 *
 * The connection (capped-backoff reconnect, ping/pong liveness, orphaned
 * socket guards) is a {@link ResilientSocket}; this class handles the Hare
 * protocol on top: one `subscribe` frame for every PV with listeners on each
 * (re)open, `initial`/`diff` frames into `PVData` snapshots, and every
 * listener marked disconnected when the socket drops.
 *
 * Framework- and environment-agnostic: takes an injectable `WebSocketFactory`
 * / `FetchLike` so it runs unmodified in browsers, Node, and tests.
 */
export class HarePVService implements PVService {
  private readonly httpPvsBaseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchFn: FetchLike | undefined;
  private readonly onErrorCallback: ((error: HareError) => void) | undefined;
  private readonly onStatusChangeCallback: ((status: HareConnectionStatus) => void) | undefined;
  private readonly socket: ResilientSocket;

  private listeners = new Map<string, Set<PVListener>>();
  private snapshots = new Map<string, PVData>();
  private metas = new Map<string, PVMetaDTO>();

  private _status: HareConnectionStatus = 'idle';

  constructor(options: HarePVServiceOptions) {
    this.apiKey = options.apiKey;
    this.httpPvsBaseUrl = options.httpPvsBaseUrl ?? deriveHttpPvsBaseUrl(options.url);
    this.fetchFn = options.fetchFn ?? defaultFetchFn();
    this.onErrorCallback = options.onError;
    this.onStatusChangeCallback = options.onStatusChange;
    this.socket = new ResilientSocket({
      url: options.url,
      apiKey: options.apiKey,
      reconnectDelaysMs: options.reconnectDelaysMs,
      pingIntervalMs: options.pingIntervalMs,
      pongTimeoutMs: options.pongTimeoutMs,
      webSocketFactory: options.webSocketFactory,
      terminalCloseCodes: options.terminalCloseCodes,
      label: 'HarePVService',
      onOpen: () => this.resubscribeAll(),
      onFrame: (frame) => this.handleFrame(frame),
      onClose: () => this.markAllDisconnected(),
      onStatusChange: (status) => this.handleSocketStatus(status),
      onError: (error) => this.handleSocketError(error),
    });
  }

  // ── PVService lifecycle ────────────────────────────────────────────────

  get isConnected(): boolean {
    return this._status === 'connected';
  }

  get status(): HareConnectionStatus {
    return this._status;
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.close();
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

    const snapshot = this.snapshots.get(pvName);
    if (snapshot) {
      listener(snapshot);
    }

    if (isFirstListener) {
      // Sent only while the socket is open; otherwise the next open
      // resubscribes every PV with listeners.
      this.socket.send({ type: 'subscribe', pvNames: [pvName] });
    }

    return () => {
      const subs = this.listeners.get(pvName);
      if (!subs) return;
      subs.delete(listener);
      if (subs.size === 0) {
        this.listeners.delete(pvName);
        this.snapshots.delete(pvName);
        this.metas.delete(pvName);
        this.socket.send({ type: 'unsubscribe', pvNames: [pvName] });
      }
    };
  }

  getSnapshot(pvName: string): PVData | undefined {
    return this.snapshots.get(pvName);
  }

  getMeta(pvName: string): PVMetaDTO | undefined {
    return this.metas.get(pvName);
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

  // ── Connection callbacks ────────────────────────────────────────────────

  private handleSocketStatus(status: SocketStatus): void {
    // A stopped socket ('closed') is reported as 'disconnected', the status
    // this service has always used for both drops and disconnect().
    this.setStatus(status === 'closed' ? 'disconnected' : status);
  }

  private handleSocketError(error: SocketError): void {
    if (error.code === 'ws_connect_failed') {
      this.reportError({
        code: error.code,
        message: `Could not open live connection: ${errorMessage(error.cause)}`,
      });
      return;
    }
    this.reportError({ code: error.code, message: error.message });
  }

  private resubscribeAll(): void {
    const pvNames = [...this.listeners.keys()];
    if (pvNames.length > 0) {
      this.socket.send({ type: 'subscribe', pvNames });
    }
  }

  private markAllDisconnected(): void {
    for (const pvName of this.listeners.keys()) {
      const previous = this.snapshots.get(pvName);
      const data: PVData = {
        ...(previous ?? DISCONNECTED_PV),
        connected: false,
        severity: AlarmSeverity.DISCONNECTED,
      };
      this.snapshots.set(pvName, data);
      this.notify(pvName, data);
    }
  }

  // ── Frame handling ──────────────────────────────────────────────────────

  private handleFrame(raw: SocketFrame): void {
    const frame = raw as unknown as HareServerFrame;
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
      case 'pong':
        // Liveness only (the socket already counted it).
        break;
    }
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

    const data: PVData = {
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
    };

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

  if (value === null || dto.connected === false) {
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
