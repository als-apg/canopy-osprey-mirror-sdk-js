// Vite dev-server proxy entries for Canopy apps.
//
// react-trace and react-squirrel each hand-rolled the same `server.proxy`
// block: forward the Canopy API (REST + WebSocket upgrades) to the backend
// and inject `X-API-Key` server-side, so the key never ships in the browser
// bundle; trace also forwards `/elog` to elog-plus with its access token.
// This is that block, once. In production a reverse proxy (nginx) owns the
// same paths and header injection.
//
// Because the proxy adds credentials, it must serve only the app's own page
// (and non-browser tools): any other website open in the developer's browser
// could otherwise send requests, or open WebSockets (which have no CORS), to
// the dev server and have the key added for it. Every route therefore refuses
// cross-origin browser requests, matches its prefix on a path-segment
// boundary, and drops the browser's cookies before forwarding.

import type { ClientRequest, IncomingMessage } from 'node:http';
import type { ProxyOptions } from 'vite';

/** Backend used when neither `target` nor `CANOPY_BASE_URL` is set. */
export const DEFAULT_CANOPY_TARGET = 'http://localhost:8000';

/** Prefix used when neither `basePath` nor `modules` is given. */
export const DEFAULT_CANOPY_BASE_PATH = '/api/canopy';

/** Default path of the elog proxy. */
export const DEFAULT_ELOG_PATH = '/elog';

export interface CanopyElogProxyOptions {
  /** Path prefix proxied to elog, stripped before forwarding. Default `'/elog'`. */
  path?: string;
  /**
   * elog-plus base URL. Default `process.env.ELOG_BASE_URL`. When neither is
   * set the elog route is left out (the app can hide its logbook features).
   */
  target?: string;
  /** Sent as `x-vouch-idp-accesstoken`. Default `process.env.ELOG_API_KEY`. */
  accessToken?: string;
}

export interface CanopyDevProxyOptions {
  /** Canopy backend. Default `process.env.CANOPY_BASE_URL`, else `'http://localhost:8000'`. */
  target?: string;
  /**
   * Injected as `X-API-Key` on proxied HTTP requests and WebSocket upgrades
   * (only when non-empty). Default `process.env.CANOPY_API_KEY`.
   */
  apiKey?: string;
  /**
   * Single-prefix mode: requests to `${basePath}/*` are forwarded to
   * `${target}/*` with the prefix stripped (WebSockets included). The app
   * then uses `{ baseUrl: basePath }` as its `CanopyConnection`, the same
   * relative path a production reverse proxy serves. Default
   * `'/api/canopy'` when `modules` is not given either.
   */
  basePath?: string;
  /**
   * Per-module mode (trace/squirrel style): each prefix, e.g. `'/hare'` or
   * `'/mole'`, is forwarded unchanged, so the app uses `{ baseUrl: '' }`.
   * May be combined with `basePath`.
   */
  modules?: string[];
  /** Also proxy elog-plus (see {@link CanopyElogProxyOptions}). Off unless given. */
  elog?: CanopyElogProxyOptions;
  /**
   * Browser origins, besides the dev server's own, allowed to use the proxy,
   * e.g. `['http://localhost:6006']` for a Storybook that calls the app's dev
   * server. Every other cross-origin browser request is refused. Default none.
   */
  allowedOrigins?: string[];
}

type Configure = NonNullable<ProxyOptions['configure']>;
type Bypass = NonNullable<ProxyOptions['bypass']>;

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/** `'api/canopy/'` -> `'/api/canopy'`; rejects the root, which would proxy everything. */
function normalizePrefix(prefix: string, what: string): string {
  const trimmed = `/${prefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')}`;
  if (trimmed === '/') {
    throw new Error(`canopyDevProxy: ${what} must be a non-root path such as '/api/canopy'`);
  }
  return trimmed;
}

/**
 * The `server.proxy` key for `prefix`. Vite treats a key starting with `^` as
 * a RegExp; this one matches the prefix only at a path-segment boundary, so
 * `/api/canopy` covers `/api/canopy`, `/api/canopy/...` and `/api/canopy?...`
 * but not `/api/canopy-foo`.
 */
function prefixKey(prefix: string): string {
  return `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/?#]|$)`;
}

/** Strip `prefix` from the start of `path` at a segment boundary (`/api/canopy/x?y` -> `/x?y`). */
function stripPrefix(path: string, prefix: string): string {
  if (!path.startsWith(prefix)) return path;
  const rest = path.slice(prefix.length);
  if (rest === '') return '/';
  if (rest.startsWith('/')) return rest;
  if (rest.startsWith('?') || rest.startsWith('#')) return `/${rest}`;
  return path; // e.g. '/api/canopyfoo' is not under '/api/canopy'
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

/** `scheme://host[:port]` with a default port dropped; undefined when unparseable or opaque. */
function normalizeOrigin(origin: string): string | undefined {
  try {
    const { origin: normalized } = new URL(origin);
    return normalized === 'null' ? undefined : normalized;
  } catch {
    return undefined;
  }
}

/**
 * True when `origin` is an http(s) origin naming the host and port the
 * request was sent to, i.e. the dev server itself. (The scheme is not
 * compared: one host and port serves one scheme.)
 */
function originMatchesHost(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // Parse Host with the Origin's scheme, so an explicit default port compares equal.
    return url.host === new URL(`${url.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

/**
 * Why the proxy must not serve `req`, or undefined when it may:
 *
 * - an `Origin` other than the dev server's own (its `Host`) and not in
 *   `allowedOrigins`; browsers send `Origin` on every WebSocket handshake,
 *   CORS request and non-GET request;
 * - `Sec-Fetch-Site: cross-site`, which also covers the no-cors GETs (an
 *   `<img>`, a link) that carry no `Origin`.
 *
 * Non-browser clients (curl, scripts) send neither header and pass.
 */
function refusal(req: IncomingMessage, allowedOrigins: ReadonlySet<string>): string | undefined {
  const origin = headerValue(req, 'origin');
  if (origin !== undefined) {
    const normalized = normalizeOrigin(origin);
    if (normalized !== undefined && allowedOrigins.has(normalized)) return undefined;
    const host = headerValue(req, 'host');
    if (!originMatchesHost(origin, host)) {
      return `a request from origin ${origin}, which is not this dev server (${host ?? 'no Host'})`;
    }
  }
  if (headerValue(req, 'sec-fetch-site') === 'cross-site') {
    return 'a cross-site request (Sec-Fetch-Site: cross-site)';
  }
  return undefined;
}

/**
 * Vite calls `bypass` before proxying an HTTP request, and also before
 * proxying a WebSocket upgrade (with `res` undefined; checked in Vite 6.4,
 * 7.3 and 8.0). Returning `false` makes Vite refuse instead of proxying.
 */
function refuseCrossOrigin(allowedOrigins: ReadonlySet<string>): Bypass {
  return (req, res) => {
    const reason = refusal(req, allowedOrigins);
    if (reason === undefined) return undefined;
    if (res) {
      // Answered here, so Vite's own 404 for `false` is a no-op.
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(
        `canopyDevProxy refused ${reason}. If that page is yours, add its origin to allowedOrigins.\n`
      );
    }
    // Vite ends a refused WebSocket upgrade with a 404 status line.
    return false;
  };
}

/**
 * Prepare each outgoing request (and WebSocket upgrade when `ws`): drop the
 * browser's cookies, which belong to the dev server and not to the target,
 * and set `header` to `value` when there is one. The credential is never
 * added to a request the origin check refuses, so it stays out even on a
 * path where some Vite version skipped `bypass`.
 */
function prepareRequests(
  header: string,
  value: string | undefined,
  ws: boolean,
  allowedOrigins: ReadonlySet<string>
): Configure {
  const prepare = (proxyReq: ClientRequest, req: IncomingMessage) => {
    proxyReq.removeHeader('cookie');
    if (value && refusal(req, allowedOrigins) === undefined) {
      proxyReq.setHeader(header, value);
    }
  };
  return (proxy) => {
    proxy.on('proxyReq', (proxyReq, req) => prepare(proxyReq, req));
    if (ws) {
      proxy.on('proxyReqWs', (proxyReq, req) => prepare(proxyReq, req));
    }
  };
}

/**
 * Build Vite `server.proxy` entries for a Canopy app:
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig, loadEnv } from 'vite';
 * import { canopyDevProxy } from '@slaclab/canopy-vite';
 *
 * export default defineConfig(({ mode }) => {
 *   const env = loadEnv(mode, process.cwd(), ''); // CANOPY_BASE_URL, CANOPY_API_KEY
 *   return {
 *     server: {
 *       proxy: canopyDevProxy({
 *         target: env.CANOPY_BASE_URL,
 *         apiKey: env.CANOPY_API_KEY,
 *         basePath: '/api/canopy',
 *       }),
 *     },
 *   };
 * });
 * ```
 *
 * Every Canopy route gets `changeOrigin` and `ws: true`; `X-API-Key` is set
 * on both HTTP requests and WebSocket upgrades when a key is configured (an
 * empty key injects nothing). Every route also refuses cross-origin browser
 * requests (HTTP 403; a WebSocket handshake gets 404), matches its prefix
 * only on a path-segment boundary (the keys are `^`-anchored RegExp
 * strings), and strips the `Cookie` header. Loading `.env` files stays the
 * app's job.
 */
export function canopyDevProxy(options: CanopyDevProxyOptions = {}): Record<string, ProxyOptions> {
  const target =
    nonEmpty(options.target) ?? nonEmpty(process.env.CANOPY_BASE_URL) ?? DEFAULT_CANOPY_TARGET;
  const apiKey = options.apiKey ?? process.env.CANOPY_API_KEY;

  const allowedOrigins = new Set<string>();
  for (const origin of options.allowedOrigins ?? []) {
    const normalized = normalizeOrigin(origin);
    if (normalized === undefined) {
      throw new Error(
        `canopyDevProxy: allowedOrigins entry ${JSON.stringify(origin)} is not an origin such as 'http://localhost:6006'`
      );
    }
    allowedOrigins.add(normalized);
  }
  const bypass = refuseCrossOrigin(allowedOrigins);
  const canopyConfigure = prepareRequests('X-API-Key', apiKey, true, allowedOrigins);

  const proxy: Record<string, ProxyOptions> = {};
  const basePath =
    options.basePath !== undefined || options.modules === undefined
      ? normalizePrefix(options.basePath ?? DEFAULT_CANOPY_BASE_PATH, 'basePath')
      : undefined;

  if (basePath !== undefined) {
    proxy[prefixKey(basePath)] = {
      target,
      changeOrigin: true,
      ws: true,
      rewrite: (path) => stripPrefix(path, basePath),
      bypass,
      configure: canopyConfigure,
    };
  }

  for (const modulePrefix of options.modules ?? []) {
    proxy[prefixKey(normalizePrefix(modulePrefix, 'each module'))] = {
      target,
      changeOrigin: true,
      ws: true,
      bypass,
      configure: canopyConfigure,
    };
  }

  if (options.elog) {
    const elogTarget = nonEmpty(options.elog.target) ?? nonEmpty(process.env.ELOG_BASE_URL);
    if (elogTarget !== undefined) {
      const elogPath = normalizePrefix(options.elog.path ?? DEFAULT_ELOG_PATH, 'elog.path');
      const accessToken = options.elog.accessToken ?? process.env.ELOG_API_KEY;
      proxy[prefixKey(elogPath)] = {
        target: elogTarget,
        changeOrigin: true,
        rewrite: (path) => stripPrefix(path, elogPath),
        bypass,
        configure: prepareRequests('x-vouch-idp-accesstoken', accessToken, false, allowedOrigins),
      };
    }
  }

  return proxy;
}
