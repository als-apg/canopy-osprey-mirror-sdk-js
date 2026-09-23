// A tiny route-matching `FetchLike` fake for tests of code built on
// `canopyFetch` (Mole, jobs, app API layers). Published as part of
// `@slaclab/canopy-client/testing`; framework-free (no test-runner imports).

import type { AbortSignalLike } from '../rest/canopyFetch.js';
import type { FetchLike } from '../transport.js';

/** The response shape `FetchLike` needs: what `jsonResponse` builds. */
export interface FakeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/**
 * A JSON response: `body` is serialized (`undefined` gives an empty body, as
 * for a 204). `ok` follows the status (2xx). Default status 200.
 *
 * ```ts
 * jsonResponse({ id: 'run-1' });
 * jsonResponse({ code: 'run_not_found', detail: 'no such run' }, { status: 404 });
 * ```
 */
export function jsonResponse(body: unknown, init: { status?: number } = {}): FakeResponse {
  const status = init.status ?? 200;
  const text = body === undefined ? '' : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** One call the fake received, as seen by route handlers and recorded on `calls`. */
export interface FakeFetchRequest {
  /** Upper-case HTTP method. */
  method: string;
  /** The URL exactly as passed to fetch. */
  url: string;
  /** Path (still percent-encoded) without origin, query, or the fake's `baseUrl` prefix, e.g. `/jobs/v1/job-1`. */
  path: string;
  /** Decoded query parameters. */
  query: Record<string, string>;
  /** Decoded values of the matched route's `:name` segments. */
  params: Record<string, string>;
  headers: Record<string, string>;
  /** The raw request body (a JSON string, a `FormData`, or undefined). */
  body: unknown;
  /** `body` parsed as JSON when it is a JSON string, else undefined. */
  json: unknown;
}

export type FakeRouteHandler = (req: FakeFetchRequest) => FakeResponse | Promise<FakeResponse>;

/**
 * What a route answers with: a fixed response, a sequence (one per call,
 * repeating the last), or a handler (throw from it to simulate a network
 * failure).
 */
export type FakeRoute = FakeResponse | FakeResponse[] | FakeRouteHandler;

/**
 * Routes keyed by `'METHOD /path'` or `'/path'` (any method). Path segments
 * starting with `:` match any one segment and are exposed on `req.params`.
 * The first matching route, in insertion order, answers.
 */
export type FakeRoutes = Record<string, FakeRoute>;

export interface CreateFakeFetchOptions {
  /**
   * Prefix stripped from request paths before matching, e.g. the connection's
   * `baseUrl` (`'http://canopy/api'` or `'/api/canopy'`). The origin of an
   * absolute URL is always ignored.
   */
  baseUrl?: string;
}

/** A `FetchLike` plus its call log and a way to change routes mid-test. */
export type FakeFetch = FetchLike & {
  /** Every call received, in order (including unmatched ones). */
  readonly calls: FakeFetchRequest[];
  /** Add or replace a route (resets its sequence position). */
  set(route: string, response: FakeRoute): void;
};

interface CompiledRoute {
  key: string;
  method: string | null;
  segments: string[];
  response: FakeRoute;
  calls: number;
}

function stripOrigin(url: string): string {
  return url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, '');
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

function compile(key: string, response: FakeRoute): CompiledRoute {
  const match = /^([A-Za-z]+)\s+(\S+)$/.exec(key.trim());
  const method = match ? match[1]!.toUpperCase() : null;
  const path = match ? match[2]! : key.trim();
  return { key, method, segments: splitPath(path), response, calls: 0 };
}

function matchRoute(
  route: CompiledRoute,
  method: string,
  segments: string[]
): Record<string, string> | null {
  if (route.method !== null && route.method !== method) return null;
  if (route.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const expected = route.segments[i]!;
    const actual = segments[i]!;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decode(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function parseQuery(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  for (const pair of search.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    query[decode(key)] = eq === -1 ? '' : decode(pair.slice(eq + 1));
  }
  return query;
}

function abortError(signal: AbortSignalLike): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * A route-matching fake `fetch` for `CanopyConnection.fetch` (or any
 * `FetchLike` injection point). Unmatched requests get a FastAPI-style
 * `404 {"detail": "No fake route for GET /path"}`. Requests honour an abort
 * signal like real fetch.
 *
 * ```ts
 * const fetch = createFakeFetch({
 *   'GET /jobs/v1/:id': [jsonResponse(pending), jsonResponse(done)],
 *   'POST /optimization/v1/runs': (req) => jsonResponse({ id: 'r1', ...(req.json as object) }),
 * });
 * const conn = { baseUrl: 'http://canopy', fetch };
 * // ... exercise code under test ...
 * expect(fetch.calls.map((c) => `${c.method} ${c.path}`)).toEqual([...]);
 * ```
 */
export function createFakeFetch(
  routes: FakeRoutes = {},
  options: CreateFakeFetchOptions = {}
): FakeFetch {
  const compiled: CompiledRoute[] = Object.entries(routes).map(([key, response]) =>
    compile(key, response)
  );
  const calls: FakeFetchRequest[] = [];
  const basePath = stripOrigin(options.baseUrl ?? '')
    .split(/[?#]/)[0]!
    .replace(/\/+$/, '');

  const respond = async (req: FakeFetchRequest): Promise<FakeResponse> => {
    const segments = splitPath(req.path);
    for (const route of compiled) {
      const params = matchRoute(route, req.method, segments);
      if (params === null) continue;
      req.params = params;
      const { response } = route;
      const index = route.calls;
      route.calls += 1;
      if (typeof response === 'function') return response(req);
      if (Array.isArray(response)) {
        const pick = response[Math.min(index, response.length - 1)];
        if (!pick) throw new Error(`createFakeFetch: route '${route.key}' has an empty sequence`);
        return pick;
      }
      return response;
    }
    return jsonResponse({ detail: `No fake route for ${req.method} ${req.path}` }, { status: 404 });
  };

  const fetch = (
    url: string,
    init: Parameters<FetchLike>[1]
  ): Promise<{ ok: boolean; status: number; text(): Promise<string> }> => {
    const signal = (init as { signal?: AbortSignalLike }).signal;
    if (signal?.aborted) return Promise.reject(abortError(signal));

    const [pathAndQuery = ''] = stripOrigin(url).split('#');
    const queryIndex = pathAndQuery.indexOf('?');
    let path = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
    if (basePath !== '' && (path === basePath || path.startsWith(`${basePath}/`))) {
      path = path.slice(basePath.length) || '/';
    }
    const body: unknown = init.body;
    let json: unknown;
    if (typeof body === 'string') {
      try {
        json = JSON.parse(body);
      } catch {
        json = undefined;
      }
    }
    const req: FakeFetchRequest = {
      method: (init.method ?? 'GET').toUpperCase(),
      url,
      path,
      query: queryIndex === -1 ? {} : parseQuery(pathAndQuery.slice(queryIndex + 1)),
      params: {},
      headers: { ...init.headers },
      body,
      json,
    };
    calls.push(req);

    const result = respond(req);
    if (!signal?.addEventListener) return result;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError(signal));
      signal.addEventListener!('abort', onAbort, { once: true });
      result.then(
        (response) => {
          signal.removeEventListener?.('abort', onAbort);
          resolve(response);
        },
        (error: unknown) => {
          signal.removeEventListener?.('abort', onAbort);
          reject(error);
        }
      );
    });
  };

  return Object.assign(fetch, {
    calls,
    set(route: string, response: FakeRoute): void {
      const next = compile(route, response);
      const existing = compiled.findIndex((entry) => entry.key === route);
      if (existing === -1) compiled.push(next);
      else compiled[existing] = next;
    },
  });
}
