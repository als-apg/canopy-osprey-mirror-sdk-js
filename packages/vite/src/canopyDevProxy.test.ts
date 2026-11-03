import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProxyOptions } from 'vite';
import { DEFAULT_ELOG_TOKEN_HEADER, canopyDevProxy } from './index.js';
import type { CanopyElogProxyOptions } from './index.js';

type ProxyServer = Parameters<NonNullable<ProxyOptions['configure']>>[0];
type Headers = Record<string, string>;

const DEV_HOST = 'localhost:5173';
const SAME_ORIGIN: Headers = { host: DEV_HOST, origin: `http://${DEV_HOST}` };

function incoming(headers: Headers): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

/** The entry Vite would pick for `url`: keys starting with `^` are RegExps, others prefixes. */
function routeFor(proxy: Record<string, ProxyOptions>, url: string): ProxyOptions | undefined {
  const key = Object.keys(proxy).find((context) =>
    context.startsWith('^') ? new RegExp(context).test(url) : url.startsWith(context)
  );
  return key === undefined ? undefined : proxy[key];
}

function route(proxy: Record<string, ProxyOptions>, url: string): ProxyOptions {
  const entry = routeFor(proxy, url);
  if (!entry) throw new Error(`no route for ${url}`);
  return entry;
}

/**
 * Run an entry's `configure` against a fake proxy and emit one proxyReq and
 * one proxyReqWs for a request with `headers`; returns the outgoing headers.
 */
function outgoingHeaders(
  entry: ProxyOptions,
  headers: Headers = SAME_ORIGIN
): { http: Headers; ws: Headers } {
  const emitter = new EventEmitter();
  entry.configure?.(emitter as unknown as ProxyServer, entry);
  const capture = () => {
    // What the browser sent; the hooks may remove or add headers.
    const out: Headers = { cookie: 'session=abc' };
    return {
      out,
      proxyReq: {
        setHeader: (name: string, value: string) => {
          out[name] = value;
        },
        removeHeader: (name: string) => {
          delete out[name];
        },
      },
    };
  };
  const http = capture();
  const ws = capture();
  emitter.emit('proxyReq', http.proxyReq, incoming(headers), {}, {});
  emitter.emit('proxyReqWs', ws.proxyReq, incoming(headers), {}, {}, undefined);
  return { http: http.out, ws: ws.out };
}

interface FakeResponse {
  statusCode: number;
  headers: Headers;
  body: string;
  ended: boolean;
}

/** Call an entry's `bypass` like Vite does: with a response for HTTP, without one for a WebSocket upgrade. */
async function bypass(
  entry: ProxyOptions,
  headers: Headers,
  kind: 'http' | 'ws' = 'http'
): Promise<{ result: unknown; res: FakeResponse }> {
  const res: FakeResponse = { statusCode: 200, headers: {}, body: '', ended: false };
  const fakeRes = {
    set statusCode(code: number) {
      res.statusCode = code;
    },
    get statusCode() {
      return res.statusCode;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    end(body?: string) {
      res.body += body ?? '';
      res.ended = true;
    },
  } as unknown as ServerResponse;
  const result = await entry.bypass!(
    incoming(headers),
    kind === 'http' ? fakeRes : undefined,
    entry
  );
  return { result, res };
}

describe('canopyDevProxy', () => {
  beforeEach(() => {
    // Keep the developer's real environment out of the defaults under test.
    vi.stubEnv('CANOPY_BASE_URL', '');
    vi.stubEnv('CANOPY_API_KEY', '');
    vi.stubEnv('CANOPY_ELOG_API_KEY', '');
    vi.stubEnv('ELOG_BASE_URL', '');
    vi.stubEnv('ELOG_API_KEY', '');
    vi.stubEnv('ELOG_TOKEN_HEADER', '');
    // The deprecated elog option warns; keep test output clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('basePath mode', () => {
    it('forwards the prefix to the target with the prefix stripped, WebSockets included', () => {
      const proxy = canopyDevProxy({ target: 'http://canopy:8000', basePath: '/api/canopy' });

      expect(Object.keys(proxy)).toHaveLength(1);
      const entry = route(proxy, '/api/canopy/optimization/v1/runs');
      expect(entry).toMatchObject({ target: 'http://canopy:8000', changeOrigin: true, ws: true });

      const rewrite = entry.rewrite!;
      expect(rewrite('/api/canopy/optimization/v1/runs?limit=5')).toBe(
        '/optimization/v1/runs?limit=5'
      );
      expect(rewrite('/api/canopy/optimization/v1/ws/runs')).toBe('/optimization/v1/ws/runs');
      expect(rewrite('/api/canopy')).toBe('/');
      expect(rewrite('/api/canopy?x=1')).toBe('/?x=1');
      expect(rewrite('/api/canopyfoo/x')).toBe('/api/canopyfoo/x'); // not under the prefix
    });

    it('matches the prefix only on a path-segment boundary', () => {
      const proxy = canopyDevProxy({ basePath: '/api/canopy' });

      expect(Object.keys(proxy)).toEqual(['^/api/canopy(?=[/?#]|$)']);
      for (const url of ['/api/canopy', '/api/canopy/', '/api/canopy/x/y', '/api/canopy?x=1']) {
        expect(routeFor(proxy, url), url).toBeDefined();
      }
      for (const url of ['/api/canopy-foo', '/api/canopyfoo/x', '/api', '/x/api/canopy/y']) {
        expect(routeFor(proxy, url), url).toBeUndefined();
      }
    });

    it('escapes RegExp metacharacters in the prefix', () => {
      const proxy = canopyDevProxy({ basePath: '/api/v1.2' });
      expect(routeFor(proxy, '/api/v1.2/runs')).toBeDefined();
      expect(routeFor(proxy, '/api/v1x2/runs')).toBeUndefined();
    });

    it('defaults to /api/canopy and the CANOPY_BASE_URL env var, else localhost:8000', () => {
      expect(route(canopyDevProxy(), '/api/canopy/x').target).toBe('http://localhost:8000');

      vi.stubEnv('CANOPY_BASE_URL', 'http://from-env:9000');
      expect(route(canopyDevProxy(), '/api/canopy/x').target).toBe('http://from-env:9000');
      // An explicit (non-empty) target wins over the env; an empty one does not.
      expect(route(canopyDevProxy({ target: 'http://explicit' }), '/api/canopy').target).toBe(
        'http://explicit'
      );
      expect(route(canopyDevProxy({ target: '' }), '/api/canopy').target).toBe(
        'http://from-env:9000'
      );
    });

    it('normalizes the prefix and rejects the root', () => {
      expect(routeFor(canopyDevProxy({ basePath: 'api/canopy/' }), '/api/canopy/x')).toBeDefined();
      expect(() => canopyDevProxy({ basePath: '/' })).toThrow(/non-root path/);
    });
  });

  describe('API key injection', () => {
    it('sets X-API-Key on proxied requests and WebSocket upgrades when a key is set', () => {
      const proxy = canopyDevProxy({ apiKey: 'dev', modules: ['/hare'], basePath: '/api/canopy' });
      expect(Object.keys(proxy)).toHaveLength(2);
      for (const entry of Object.values(proxy)) {
        expect(outgoingHeaders(entry)).toEqual({
          http: { 'X-API-Key': 'dev' },
          ws: { 'X-API-Key': 'dev' },
        });
      }
    });

    it('falls back to CANOPY_API_KEY, and injects nothing without a key', () => {
      vi.stubEnv('CANOPY_API_KEY', 'env-key');
      expect(outgoingHeaders(route(canopyDevProxy(), '/api/canopy')).ws).toEqual({
        'X-API-Key': 'env-key',
      });

      // An explicit empty key overrides the env var: no header.
      expect(outgoingHeaders(route(canopyDevProxy({ apiKey: '' }), '/api/canopy'))).toEqual({
        http: {},
        ws: {},
      });
      vi.stubEnv('CANOPY_API_KEY', '');
      expect(outgoingHeaders(route(canopyDevProxy(), '/api/canopy'))).toEqual({ http: {}, ws: {} });
    });

    it('strips the Cookie header on every route, with or without a key', () => {
      const proxy = canopyDevProxy({
        modules: ['/hare'],
        basePath: '/api/canopy',
        elog: { target: 'http://elog' },
      });
      for (const entry of Object.values(proxy)) {
        const { http, ws } = outgoingHeaders(entry);
        expect(http.cookie).toBeUndefined();
        if (entry.ws) expect(ws.cookie).toBeUndefined();
      }
    });

    it('never adds the key to a request the origin check refuses', () => {
      const entry = route(canopyDevProxy({ apiKey: 'dev' }), '/api/canopy');
      expect(outgoingHeaders(entry, { host: DEV_HOST, origin: 'https://evil.example' })).toEqual({
        http: {},
        ws: {},
      });
    });
  });

  describe('cross-origin requests', () => {
    const entry = () => route(canopyDevProxy({ apiKey: 'dev' }), '/api/canopy');

    it('lets same-origin browser requests and WebSocket upgrades through', async () => {
      for (const headers of [
        SAME_ORIGIN,
        { ...SAME_ORIGIN, 'sec-fetch-site': 'same-origin' },
        // Same-origin GETs carry no Origin, only Sec-Fetch-Site.
        { host: DEV_HOST, 'sec-fetch-site': 'same-origin' },
        // Typed into the address bar.
        { host: DEV_HOST, 'sec-fetch-site': 'none' },
        // Explicit default port on one side only.
        { host: 'localhost:80', origin: 'http://localhost' },
        { host: 'LocalHost:5173', origin: 'http://localhost:5173' },
        { host: '[::1]:5173', origin: 'http://[::1]:5173' },
      ]) {
        expect((await bypass(entry(), headers, 'http')).result, JSON.stringify(headers)).toBe(
          undefined
        );
        expect((await bypass(entry(), headers, 'ws')).result, JSON.stringify(headers)).toBe(
          undefined
        );
      }
    });

    it('lets non-browser clients (no Origin, no Sec-Fetch-Site) through', async () => {
      expect((await bypass(entry(), { host: DEV_HOST })).result).toBeUndefined();
      expect((await bypass(entry(), { host: DEV_HOST }, 'ws')).result).toBeUndefined();
    });

    it('refuses an HTTP request from another origin with 403', async () => {
      const { result, res } = await bypass(entry(), {
        host: DEV_HOST,
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      });
      expect(result).toBe(false);
      expect(res).toMatchObject({ statusCode: 403, ended: true });
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      expect(res.body).toContain('https://evil.example');
    });

    it('refuses a WebSocket upgrade from another origin', async () => {
      const { result, res } = await bypass(
        entry(),
        { host: DEV_HOST, origin: 'https://evil.example' },
        'ws'
      );
      expect(result).toBe(false); // Vite then ends the socket with a 404 status line
      expect(res.ended).toBe(false);
    });

    it('refuses other hosts and ports, opaque and malformed origins', async () => {
      for (const origin of [
        'http://localhost:6006', // same site, other origin
        'http://127.0.0.1:5173', // same server, but a page on another origin
        'chrome-extension://abcdefghijklmnop',
        'null',
        'not a url',
        'http://localhost:5173, http://evil.example',
      ]) {
        expect((await bypass(entry(), { host: DEV_HOST, origin }, 'ws')).result, origin).toBe(
          false
        );
      }
      // An Origin with no Host to compare against.
      expect((await bypass(entry(), { origin: `http://${DEV_HOST}` })).result).toBe(false);
    });

    it('refuses a cross-site request that carries no Origin (a no-cors GET)', async () => {
      const { result, res } = await bypass(entry(), {
        host: DEV_HOST,
        'sec-fetch-site': 'cross-site',
      });
      expect(result).toBe(false);
      expect(res.statusCode).toBe(403);
    });

    it('refuses a same-site request with no Origin (a page on another localhost port)', async () => {
      // e.g. <img src="http://localhost:5173/api/canopy/..."> on http://localhost:3000:
      // no Origin, and Sec-Fetch-Site ignores ports.
      const headers = { host: DEV_HOST, 'sec-fetch-site': 'same-site' };
      const { result, res } = await bypass(entry(), headers);
      expect(result).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('same-site');
      expect((await bypass(entry(), headers, 'ws')).result).toBe(false);
      expect(outgoingHeaders(entry(), headers)).toEqual({ http: {}, ws: {} });
    });

    it('allows the origins listed in allowedOrigins', async () => {
      const proxy = canopyDevProxy({ allowedOrigins: ['http://LOCALHOST:6006/'] });
      const storybook = { host: DEV_HOST, origin: 'http://localhost:6006' };
      expect((await bypass(route(proxy, '/api/canopy'), storybook, 'ws')).result).toBeUndefined();
      const other = { host: DEV_HOST, origin: 'http://localhost:6007' };
      expect((await bypass(route(proxy, '/api/canopy'), other, 'ws')).result).toBe(false);

      expect(() => canopyDevProxy({ allowedOrigins: ['localhost:6006'] })).toThrow(
        /allowedOrigins/
      );
    });

    it('guards every route: modules and elog too', async () => {
      const proxy = canopyDevProxy({
        modules: ['/hare'],
        basePath: '/api/canopy',
        elog: { target: 'http://elog' },
      });
      expect(Object.keys(proxy)).toHaveLength(3);
      for (const route of Object.values(proxy)) {
        const cross = { host: DEV_HOST, origin: 'https://evil.example' };
        expect((await bypass(route, cross)).result).toBe(false);
        expect((await bypass(route, SAME_ORIGIN)).result).toBeUndefined();
      }
    });
  });

  describe('modules mode', () => {
    it('forwards each module prefix unchanged (no rewrite) with ws enabled', () => {
      const proxy = canopyDevProxy({ target: 'http://t', modules: ['/hare', 'mole', '/fox/'] });

      expect(Object.keys(proxy)).toEqual([
        '^/hare(?=[/?#]|$)',
        '^/mole(?=[/?#]|$)',
        '^/fox(?=[/?#]|$)',
      ]);
      for (const entry of Object.values(proxy)) {
        expect(entry).toMatchObject({ target: 'http://t', changeOrigin: true, ws: true });
        expect(entry.rewrite).toBeUndefined();
      }
      expect(routeFor(proxy, '/hare/v1/ws/pvs')).toBeDefined();
      expect(routeFor(proxy, '/hare-foo/v1')).toBeUndefined();
      expect(routeFor(proxy, '/foxes')).toBeUndefined();
    });

    it('can be combined with an explicit basePath', () => {
      const proxy = canopyDevProxy({ basePath: '/api', modules: ['/hare'] });
      expect(Object.keys(proxy)).toHaveLength(2);
      expect(route(proxy, '/api/x').rewrite).toBeDefined();
      expect(route(proxy, '/hare/x').rewrite).toBeUndefined();
    });
  });

  describe("Canopy's e-log module", () => {
    it('is under basePath like any module: forwarded to /elog/... with X-API-Key', () => {
      const proxy = canopyDevProxy({ target: 'http://canopy:8000', apiKey: 'dev' });

      expect(Object.keys(proxy)).toHaveLength(1);
      const entry = route(proxy, '/api/canopy/elog/v1/apps/trace/entries');
      expect(entry.target).toBe('http://canopy:8000');
      expect(entry.rewrite!('/api/canopy/elog/v1/apps/trace/entries')).toBe(
        '/elog/v1/apps/trace/entries'
      );
      expect(outgoingHeaders(entry).http).toEqual({ 'X-API-Key': 'dev' });
    });

    it("is forwarded unchanged with X-API-Key when '/elog' is in modules", () => {
      const proxy = canopyDevProxy({
        target: 'http://t',
        apiKey: 'dev',
        modules: ['/hare', '/elog'],
      });

      const entry = route(proxy, '/elog/v1/apps/trace/config');
      expect(entry).toMatchObject({ target: 'http://t', changeOrigin: true, ws: true });
      expect(entry.rewrite).toBeUndefined();
      expect(outgoingHeaders(entry).http).toEqual({ 'X-API-Key': 'dev' });
    });

    it('sends elogApiKey to the /elog module entry, apiKey to the others', () => {
      const proxy = canopyDevProxy({
        apiKey: 'read-only',
        elogApiKey: 'elog-write',
        modules: ['/hare', '/elog/'],
      });

      expect(outgoingHeaders(route(proxy, '/elog/v1/apps/trace/entries'))).toEqual({
        http: { 'X-API-Key': 'elog-write' },
        ws: { 'X-API-Key': 'elog-write' },
      });
      expect(outgoingHeaders(route(proxy, '/hare/v1/ws/pvs')).ws).toEqual({
        'X-API-Key': 'read-only',
      });
    });

    it('adds a ${basePath}/elog entry ahead of basePath when elogApiKey differs', async () => {
      const proxy = canopyDevProxy({
        target: 'http://t',
        apiKey: 'read-only',
        elogApiKey: 'elog-write',
      });

      // Vite uses the first matching key, so the e-log entry must come first.
      expect(Object.keys(proxy)).toEqual([
        '^/api/canopy/elog(?=[/?#]|$)',
        '^/api/canopy(?=[/?#]|$)',
      ]);
      const elog = route(proxy, '/api/canopy/elog/v1/apps/trace/attachments');
      expect(elog).toMatchObject({ target: 'http://t', changeOrigin: true, ws: true });
      expect(elog.rewrite!('/api/canopy/elog/v1/apps/trace/attachments')).toBe(
        '/elog/v1/apps/trace/attachments'
      );
      expect(outgoingHeaders(elog).http).toEqual({ 'X-API-Key': 'elog-write' });

      for (const url of ['/api/canopy/elogger', '/api/canopy/hare/v1/pvs/X']) {
        expect(outgoingHeaders(route(proxy, url)).http, url).toEqual({ 'X-API-Key': 'read-only' });
      }

      const cross = { host: DEV_HOST, origin: 'https://evil.example' };
      expect((await bypass(elog, cross)).result).toBe(false);
      expect(outgoingHeaders(elog, cross)).toEqual({ http: {}, ws: {} });
    });

    it('reads CANOPY_ELOG_API_KEY; unset, empty or equal to apiKey means apiKey', () => {
      const elogKey = (options: Parameters<typeof canopyDevProxy>[0]) =>
        outgoingHeaders(route(canopyDevProxy(options), '/api/canopy/elog/x')).http;

      expect(Object.keys(canopyDevProxy({ apiKey: 'dev', elogApiKey: 'dev' }))).toHaveLength(1);
      expect(elogKey({ apiKey: 'dev', elogApiKey: '' })).toEqual({ 'X-API-Key': 'dev' });
      // With no apiKey at all, only the e-log module gets a key.
      expect(elogKey({ apiKey: '', elogApiKey: 'elog-write' })).toEqual({
        'X-API-Key': 'elog-write',
      });
      expect(
        outgoingHeaders(route(canopyDevProxy({ apiKey: '', elogApiKey: 'e' }), '/api/canopy/x'))
          .http
      ).toEqual({});

      vi.stubEnv('CANOPY_ELOG_API_KEY', 'env-elog');
      expect(elogKey({ apiKey: 'dev' })).toEqual({ 'X-API-Key': 'env-elog' });
      // An explicit option wins over the env var, even an empty one.
      expect(elogKey({ apiKey: 'dev', elogApiKey: 'opt' })).toEqual({ 'X-API-Key': 'opt' });
      expect(elogKey({ apiKey: 'dev', elogApiKey: '' })).toEqual({ 'X-API-Key': 'dev' });
    });
  });

  describe('elog (deprecated elog-plus proxy)', () => {
    it('warns that it is deprecated, only when the route is built', () => {
      const warn = vi.mocked(console.warn);
      canopyDevProxy({ elog: {} });
      expect(warn).not.toHaveBeenCalled();

      canopyDevProxy({ elog: { target: 'http://elog' } });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/deprecated.*removed in 0\.4/);
    });

    it('refuses a path that overlaps a Canopy route instead of replacing it', () => {
      expect(() => canopyDevProxy({ modules: ['/elog'], elog: { target: 'http://elog' } })).toThrow(
        /elog\.path '\/elog' overlaps the Canopy route '\/elog'/
      );
      expect(() =>
        canopyDevProxy({ basePath: '/api/canopy', elog: { target: 'http://elog', path: '/api' } })
      ).toThrow(/overlaps the Canopy route '\/api\/canopy'/);
      expect(() =>
        canopyDevProxy({ modules: ['/elog'], elog: { target: 'http://elog', path: '/elog/v2' } })
      ).toThrow(/overlaps/);

      // Elsewhere, both coexist.
      const proxy = canopyDevProxy({
        modules: ['/elog'],
        elog: { target: 'http://elog', path: '/elog-plus' },
      });
      expect(route(proxy, '/elog/v1/apps/trace/config').target).toBe('http://localhost:8000');
      expect(route(proxy, '/elog-plus/v2/entries').target).toBe('http://elog');
    });

    it('forwards /elog to elog-plus with the prefix stripped and the access token injected', () => {
      const proxy = canopyDevProxy({
        elog: { target: 'https://elog.example.org', accessToken: 'tok' },
      });

      const entry = route(proxy, '/elog/v2/entries');
      expect(entry).toMatchObject({ target: 'https://elog.example.org', changeOrigin: true });
      expect(entry.ws).toBeUndefined();
      expect(entry.rewrite!('/elog/v2/entries')).toBe('/v2/entries');
      expect(entry.rewrite!('/elog/v1/logbooks?x=1')).toBe('/v1/logbooks?x=1');
      expect(routeFor(proxy, '/elogger')).toBeUndefined();
      // Only HTTP requests carry the token; the elog route has no WebSockets
      // (so no proxyReqWs hook: the fake upgrade keeps its cookie).
      expect(outgoingHeaders(entry)).toEqual({
        http: { 'x-vouch-idp-accesstoken': 'tok' },
        ws: { cookie: 'session=abc' },
      });
      // The Canopy route never gets the elog token (and vice versa).
      expect(outgoingHeaders(route(proxy, '/api/canopy')).http).toEqual({});
    });

    it('reads ELOG_BASE_URL / ELOG_API_KEY, honours a custom path, and is omitted without a target', () => {
      expect(Object.keys(canopyDevProxy({ elog: {} }))).toHaveLength(1);

      vi.stubEnv('ELOG_BASE_URL', 'http://elog:8080');
      vi.stubEnv('ELOG_API_KEY', 'env-tok');
      const entry = route(canopyDevProxy({ elog: { path: '/logbook' } }), '/logbook/v1');
      expect(entry.target).toBe('http://elog:8080');
      expect(entry.rewrite!('/logbook/v1/logbooks')).toBe('/v1/logbooks');
      expect(outgoingHeaders(entry).http).toEqual({ 'x-vouch-idp-accesstoken': 'env-tok' });

      // No token: forwarded without the header.
      vi.stubEnv('ELOG_API_KEY', '');
      expect(outgoingHeaders(route(canopyDevProxy({ elog: {} }), '/elog/x')).http).toEqual({});
    });

    it('sends the token in a configurable header (option, then ELOG_TOKEN_HEADER, then the Vouch default)', () => {
      const headersFor = (elog: CanopyElogProxyOptions) =>
        outgoingHeaders(route(canopyDevProxy({ elog }), '/elog/x')).http;
      const base = { target: 'https://elog.example.org', accessToken: 'tok' };

      expect(headersFor(base)).toEqual({ [DEFAULT_ELOG_TOKEN_HEADER]: 'tok' });
      expect(DEFAULT_ELOG_TOKEN_HEADER).toBe('x-vouch-idp-accesstoken');
      expect(headersFor({ ...base, accessTokenHeader: 'Authorization' })).toEqual({
        Authorization: 'tok',
      });

      vi.stubEnv('ELOG_TOKEN_HEADER', 'x-auth-token');
      expect(headersFor(base)).toEqual({ 'x-auth-token': 'tok' });
      // The option wins over the env var; an empty option falls back to it.
      expect(headersFor({ ...base, accessTokenHeader: 'x-other' })).toEqual({ 'x-other': 'tok' });
      expect(headersFor({ ...base, accessTokenHeader: '' })).toEqual({ 'x-auth-token': 'tok' });
    });
  });
});
