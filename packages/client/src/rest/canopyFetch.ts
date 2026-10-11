// REST core for Canopy's HTTP APIs: the `{code, detail}` error envelope,
// query building, and a typed fetch wrapper shared by the Mole, Jobs, and
// Hare REST surfaces. Every call takes an explicit `CanopyConnection` (base
// URL + API key + injectable fetch) and may set a method and body, so writes
// such as Hare PV puts share the same envelope-aware error path.

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
 * One entry of a FastAPI request-validation error
 * (`422 {"detail": [{loc, msg, type, ...}]}`), which Canopy does not wrap in
 * its `{code, detail}` envelope.
 */
export interface ValidationIssue {
  /** Where the problem is, e.g. `['body', 'variables', 0, 'lower']`. */
  loc: (string | number)[];
  /** Human-readable message, e.g. `"Input should be 'pause', 'resume' or 'stop'"`. */
  msg: string;
  /** Pydantic error type, e.g. `'literal_error'`. */
  type: string;
  /** The offending input value, when the server echoed it. */
  input?: unknown;
  /** Extra pydantic context (limits, expected values, ...), when present. */
  ctx?: Record<string, unknown>;
}

/**
 * A failed Canopy API call.
 *
 * - `code`: the backend's machine-readable slug; `validation_error` for a
 *   FastAPI request-validation body (see `issues`); `not_found` (404) or
 *   `http_error` for a framework error without a code (e.g. an unknown
 *   route); `network_error` (status 0) when no response arrived;
 *   `unknown_error` when the body was not JSON at all.
 * - `status`: the HTTP status (0 when the request never got a response).
 * - `detail`: always a human-readable string.
 * - `issues`: the structured entries behind a `validation_error`.
 */
export class CanopyError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: string;
  readonly issues?: ValidationIssue[];

  constructor(code: string, status: number, detail: string, issues?: ValidationIssue[]) {
    // Guard the documented contract even for callers passing a non-string.
    // JSON.stringify returns undefined (not a string) for undefined,
    // functions and symbols.
    const text = typeof detail === 'string' ? detail : (JSON.stringify(detail) ?? String(detail));
    super(`${code} (${status}): ${text}`);
    this.name = 'CanopyError';
    this.code = code;
    this.status = status;
    this.detail = text;
    if (issues !== undefined) {
      this.issues = issues;
    }
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
  /**
   * Request body. Serialized as JSON with `Content-Type: application/json`,
   * except a `FormData`, which is passed through untouched (and without a
   * Content-Type, so `fetch` sets the multipart boundary itself).
   */
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
 * True for a `FormData` from this realm (`globalThis.FormData`) or any other
 * (jsdom, undici, a polyfill — detected by its `Symbol.toStringTag`), without
 * naming the DOM type.
 */
function isFormData(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const FormDataCtor = (globalThis as { FormData?: abstract new (...args: never) => unknown })
    .FormData;
  if (typeof FormDataCtor === 'function' && value instanceof FormDataCtor) return true;
  return Object.prototype.toString.call(value) === '[object FormData]';
}

/**
 * A failure while fetching or reading the response: an abort passes through
 * unchanged, anything else becomes `CanopyError('network_error', 0, ...)`.
 *
 * Once the caller's signal has aborted, whatever fetch rejected with is the
 * abort: real fetch rejects with `signal.reason` when one was given (any
 * error, e.g. `AbortSignal.timeout()`'s `TimeoutError`), not an `AbortError`.
 */
function networkFailure(err: unknown, signal: AbortSignalLike | undefined): unknown {
  const error = err as { name?: unknown; message?: unknown } | null | undefined;
  if (signal?.aborted || error?.name === 'AbortError') return err;
  return new CanopyError(
    'network_error',
    0,
    typeof error?.message === 'string' ? error.message : 'network failure'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `['body', 'variables', 0, 'lower']` -> `'body.variables[0].lower'`. */
function formatLoc(loc: (string | number)[]): string {
  let out = '';
  for (const part of loc) {
    out += typeof part === 'number' ? `[${part}]` : out === '' ? part : `.${part}`;
  }
  return out;
}

function toValidationIssue(entry: unknown): ValidationIssue {
  if (!isRecord(entry)) {
    return {
      loc: [],
      msg: typeof entry === 'string' ? entry : JSON.stringify(entry),
      type: 'unknown',
    };
  }
  const issue: ValidationIssue = {
    loc: Array.isArray(entry.loc)
      ? entry.loc.filter(
          (part): part is string | number => typeof part === 'string' || typeof part === 'number'
        )
      : [],
    msg: typeof entry.msg === 'string' ? entry.msg : JSON.stringify(entry),
    type: typeof entry.type === 'string' ? entry.type : 'unknown',
  };
  if ('input' in entry) issue.input = entry.input;
  if (isRecord(entry.ctx)) issue.ctx = entry.ctx;
  return issue;
}

/** `code` for a framework error body that carries none (e.g. FastAPI's `{"detail": "Not Found"}`). */
function codeForStatus(status: number): string {
  return status === 404 ? 'not_found' : 'http_error';
}

/**
 * Map a non-2xx response to a {@link CanopyError}:
 *
 * - Canopy's envelope `{code, detail}` -> as-is.
 * - FastAPI validation `{"detail": [{loc, msg, type}, ...]}` ->
 *   `validation_error` with `issues` and a readable `detail`
 *   (`"body.bounds: Value error, ...; query.limit: ..."`).
 * - FastAPI/Starlette `{"detail": "..."}` without a code -> `not_found`
 *   (404) or `http_error`.
 * - Anything else -> `unknown_error` with the raw body text (or `HTTP n`).
 */
function errorFromResponse(status: number, text: string): CanopyError {
  const fallbackDetail = text || `HTTP ${status}`;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!isRecord(body)) {
    return new CanopyError('unknown_error', status, fallbackDetail);
  }

  const code = typeof body.code === 'string' && body.code !== '' ? body.code : undefined;
  const { detail } = body;
  if (Array.isArray(detail)) {
    const issues = detail.map(toValidationIssue);
    const readable = issues
      .map((issue) => (issue.loc.length > 0 ? `${formatLoc(issue.loc)}: ${issue.msg}` : issue.msg))
      .join('; ');
    return new CanopyError(
      code ?? 'validation_error',
      status,
      readable || 'Request validation failed',
      issues
    );
  }
  if (typeof detail === 'string') {
    return new CanopyError(code ?? codeForStatus(status), status, detail);
  }
  if (detail !== undefined && detail !== null) {
    // An HTTPException raised with a structured detail.
    return new CanopyError(code ?? codeForStatus(status), status, JSON.stringify(detail));
  }
  return new CanopyError(code ?? 'unknown_error', status, fallbackDetail);
}

/**
 * Fetch `path` from a Canopy deployment and parse the JSON response.
 *
 * - Non-2xx responses throw {@link CanopyError} with the backend's
 *   `{code, detail}` envelope. FastAPI's own bodies, which have no `code`,
 *   are normalized too: request-validation arrays become `validation_error`
 *   (structured entries on `issues`), a bare `{"detail": "..."}` becomes
 *   `not_found` (404) or `http_error`. A non-JSON body gives `unknown_error`
 *   with the raw text.
 * - Network-level failures, including a body that fails mid-read, are
 *   normalized to `CanopyError('network_error', 0, ...)`. Only a misuse
 *   (such as no `fetch` implementation) throws something else.
 * - Aborts pass through unchanged (an `AbortError`, or the signal's own
 *   `reason`, such as a `TimeoutError`), so callers can distinguish
 *   cancellation from failure.
 * - An empty 2xx body resolves to `undefined` (e.g. 204 responses).
 * - A `FormData` body is sent as-is (multipart); anything else as JSON.
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
    body?: unknown;
    signal?: AbortSignalLike;
  } = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.body !== undefined) {
    if (isFormData(options.body)) {
      // No Content-Type: fetch derives `multipart/form-data; boundary=...`.
      init.body = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
  }
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  let res: Awaited<ReturnType<FetchLike>>;
  try {
    // `FetchLike` does not declare `signal` (so the global `fetch` stays
    // assignable to it), and this package cannot name `FormData`. Real fetch
    // and test fakes accept both, so cast here instead of widening the type.
    res = await fetchFn(url, init as Parameters<FetchLike>[1]);
  } catch (err) {
    throw networkFailure(err, options.signal);
  }

  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    // The connection dropped while the body was streaming in.
    throw networkFailure(err, options.signal);
  }

  if (!res.ok) {
    throw errorFromResponse(res.status, text);
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
