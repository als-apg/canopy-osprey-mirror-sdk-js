// Vite dev-server proxy entries for Canopy apps.
//
// react-trace and react-squirrel each hand-rolled the same `server.proxy`
// block: forward the Canopy API (REST + WebSocket upgrades) to the backend
// and inject `X-API-Key` server-side, so the key never ships in the browser
// bundle; trace also forwards `/elog` to elog-plus with its access token.
// This is that block, once. In production a reverse proxy (nginx) owns the
// same paths and header injection.

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
}

type Configure = NonNullable<ProxyOptions['configure']>;

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

/** Strip `prefix` from the start of `path` at a segment boundary (`/api/canopy/x?y` -> `/x?y`). */
function stripPrefix(path: string, prefix: string): string {
  if (!path.startsWith(prefix)) return path;
  const rest = path.slice(prefix.length);
  if (rest === '') return '/';
  if (rest.startsWith('/')) return rest;
  if (rest.startsWith('?') || rest.startsWith('#')) return `/${rest}`;
  return path; // e.g. '/api/canopyfoo' is not under '/api/canopy'
}

/** Set `header` on proxied requests (and WebSocket upgrades when `ws`); undefined without a value. */
function injectHeader(
  header: string,
  value: string | undefined,
  ws: boolean
): Configure | undefined {
  if (!value) return undefined;
  return (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      proxyReq.setHeader(header, value);
    });
    if (ws) {
      proxy.on('proxyReqWs', (proxyReq) => {
        proxyReq.setHeader(header, value);
      });
    }
  };
}

function withConfigure(options: ProxyOptions, configure: Configure | undefined): ProxyOptions {
  return configure ? { ...options, configure } : options;
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
 * empty key injects nothing). Loading `.env` files stays the app's job.
 */
export function canopyDevProxy(options: CanopyDevProxyOptions = {}): Record<string, ProxyOptions> {
  const target =
    nonEmpty(options.target) ?? nonEmpty(process.env.CANOPY_BASE_URL) ?? DEFAULT_CANOPY_TARGET;
  const apiKey = options.apiKey ?? process.env.CANOPY_API_KEY;
  const injectApiKey = injectHeader('X-API-Key', apiKey, true);

  const proxy: Record<string, ProxyOptions> = {};
  const basePath =
    options.basePath !== undefined || options.modules === undefined
      ? normalizePrefix(options.basePath ?? DEFAULT_CANOPY_BASE_PATH, 'basePath')
      : undefined;

  if (basePath !== undefined) {
    proxy[basePath] = withConfigure(
      {
        target,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => stripPrefix(path, basePath),
      },
      injectApiKey
    );
  }

  for (const modulePrefix of options.modules ?? []) {
    proxy[normalizePrefix(modulePrefix, 'each module')] = withConfigure(
      { target, changeOrigin: true, ws: true },
      injectApiKey
    );
  }

  if (options.elog) {
    const elogTarget = nonEmpty(options.elog.target) ?? nonEmpty(process.env.ELOG_BASE_URL);
    if (elogTarget !== undefined) {
      const elogPath = normalizePrefix(options.elog.path ?? DEFAULT_ELOG_PATH, 'elog.path');
      const accessToken = options.elog.accessToken ?? process.env.ELOG_API_KEY;
      proxy[elogPath] = withConfigure(
        {
          target: elogTarget,
          changeOrigin: true,
          rewrite: (path) => stripPrefix(path, elogPath),
        },
        injectHeader('x-vouch-idp-accesstoken', accessToken, false)
      );
    }
  }

  return proxy;
}
