// REST core for Canopy's HTTP APIs: the `{code, detail}` error envelope,
// query building, and a typed fetch wrapper shared by the Mole, Jobs, and
// Hare REST surfaces.
//
// Ported from react-trace's `src/api/client.ts`, generalized in two ways:
// - an explicit `CanopyConnection` (base URL + API key + injectable fetch)
//   replaces trace's assumption of a dev proxy at `''` that injects the key;
// - `method`/`body` support so non-GET endpoints (e.g. Hare PV writes) can
//   share the same envelope-aware error path.

import type { FetchLike } from '../transport.js';

/**
 * Error envelope returned by every non-2xx Canopy response
 * (`canopy.core.errors.register_canopy_error_handler`).
 */
export interface ErrorEnvelope {
  code: string;
  detail: string;
}

/**
 * A failed Canopy API call: `code` is the backend's machine-readable slug
 * (or `network_error` / `unknown_error` when no envelope was available),
 * `status` the HTTP status (0 when the request never got a response).
 */
export class CanopyError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: string;

  constructor(code: string, status: number, detail: string) {
    super(`${code} (${status}): ${detail}`);
    this.name = 'CanopyError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Structural stand-in for `AbortSignal` — this package deliberately compiles
 * without the DOM lib or `@types/node`, so it never names the real type.
 * A real `AbortSignal` satisfies it.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener?(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener?(type: 'abort', listener: () => void): void;
}

/** How to reach one Canopy deployment. Passed to every REST helper. */
export interface CanopyConnection {
  /**
   * Origin (plus optional path prefix) of the Canopy API, e.g.
   * `https://canopy.example.org`. Module paths like `/mole/v1/...` are
   * appended to it. Trailing slashes are tolerated.
   */
  baseUrl: string;
  /** Sent as the `X-API-Key` header on every request when present. */
  apiKey?: string;
  /** Injectable for tests / Node consumers. Default: `globalThis.fetch`. */
  fetch?: FetchLike;
}

export interface CanopyFetchOptions {
  /** HTTP method. Default `GET`. */
  method?: string;
  /** Query parameters; `undefined`/`null` entries are skipped. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** JSON-serialized request body; also sets `Content-Type: application/json`. */
  body?: unknown;
  signal?: AbortSignalLike;
}

/**
 * Serialize query params. Hand-rolled because `URLSearchParams` belongs to
 * the DOM/Node type universes this package avoids (`%20` for spaces instead
 * of `+`; both are valid on the wire).
 */
function buildQuery(query: CanopyFetchOptions['query']): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function defaultFetchFn(): FetchLike | undefined {
  return (globalThis as { fetch?: FetchLike }).fetch;
}

/**
 * Fetch `path` from a Canopy deployment and parse the JSON response.
 *
 * - Non-2xx responses throw {@link CanopyError} with the backend's
 *   `{code, detail}` envelope (falling back to the raw body text when the
 *   body isn't an envelope).
 * - Network-level failures are normalized to `CanopyError('network_error', 0, ...)`.
 * - Aborts pass through unchanged (`err.name === 'AbortError'`), so callers
 *   can distinguish cancellation from failure.
 * - An empty 2xx body resolves to `undefined` (e.g. 204 responses).
 */
export async function canopyFetch<T>(
  conn: CanopyConnection,
  path: string,
  options: CanopyFetchOptions = {}
): Promise<T> {
  const fetchFn = conn.fetch ?? defaultFetchFn();
  if (!fetchFn) {
    throw new Error(
      'canopyFetch: no fetch implementation available (set `fetch` on the connection or run in an environment with global fetch).'
    );
  }

  const url = `${conn.baseUrl.replace(/\/+$/, '')}${path}${buildQuery(options.query)}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (conn.apiKey) {
    headers['X-API-Key'] = conn.apiKey;
  }

  const init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignalLike;
  } = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  let res: Awaited<ReturnType<FetchLike>>;
  try {
    // `FetchLike` declares the minimal init HarePVService has always sent
    // (`body` required, no `signal`), and that published shape must stay
    // stable. Real fetch and test fakes both tolerate an absent body and an
    // extra signal, so cast here instead of widening the type.
    res = await fetchFn(url, init as Parameters<FetchLike>[1]);
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    throw new CanopyError('network_error', 0, (err as Error).message ?? 'network failure');
  }

  const text = await res.text();

  if (!res.ok) {
    let envelope: ErrorEnvelope | null = null;
    try {
      envelope = JSON.parse(text) as ErrorEnvelope;
    } catch {
      // Fall through with no envelope.
    }
    const code = envelope?.code ?? 'unknown_error';
    // `FetchLike` responses carry no statusText, so fall back to the raw
    // body text (which also preserves non-envelope error messages).
    const detail = envelope?.detail ?? (text || `HTTP ${res.status}`);
    throw new CanopyError(code, res.status, detail);
  }

  if (text === '') {
    return undefined as unknown as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CanopyError('invalid_json', res.status, 'Response body was not valid JSON');
  }
}
