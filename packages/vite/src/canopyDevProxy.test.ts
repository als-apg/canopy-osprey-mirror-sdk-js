import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProxyOptions } from 'vite';
import { canopyDevProxy } from './index.js';

type ProxyServer = Parameters<NonNullable<ProxyOptions['configure']>>[0];

/** Run an entry's `configure` against a fake proxy and emit one proxyReq + proxyReqWs. */
function headersSetBy(entry: ProxyOptions): {
  http: Record<string, string>;
  ws: Record<string, string>;
} {
  const emitter = new EventEmitter();
  entry.configure?.(emitter as unknown as ProxyServer, entry);
  const capture = () => {
    const headers: Record<string, string> = {};
    return {
      headers,
      proxyReq: {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      },
    };
  };
  const http = capture();
  const ws = capture();
  emitter.emit('proxyReq', http.proxyReq, {}, {}, {});
  emitter.emit('proxyReqWs', ws.proxyReq, {}, {}, {}, undefined);
  return { http: http.headers, ws: ws.headers };
}

describe('canopyDevProxy', () => {
  beforeEach(() => {
    // Keep the developer's real environment out of the defaults under test.
    vi.stubEnv('CANOPY_BASE_URL', '');
    vi.stubEnv('CANOPY_API_KEY', '');
    vi.stubEnv('ELOG_BASE_URL', '');
    vi.stubEnv('ELOG_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('basePath mode', () => {
    it('forwards the prefix to the target with the prefix stripped, WebSockets included', () => {
      const proxy = canopyDevProxy({ target: 'http://canopy:8000', basePath: '/api/canopy' });

      expect(Object.keys(proxy)).toEqual(['/api/canopy']);
      const entry = proxy['/api/canopy']!;
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

    it('defaults to /api/canopy and the CANOPY_BASE_URL env var, else localhost:8000', () => {
      expect(canopyDevProxy()['/api/canopy']?.target).toBe('http://localhost:8000');

      vi.stubEnv('CANOPY_BASE_URL', 'http://from-env:9000');
      expect(canopyDevProxy()['/api/canopy']?.target).toBe('http://from-env:9000');
      // An explicit (non-empty) target wins over the env; an empty one does not.
      expect(canopyDevProxy({ target: 'http://explicit' })['/api/canopy']?.target).toBe(
        'http://explicit'
      );
      expect(canopyDevProxy({ target: '' })['/api/canopy']?.target).toBe('http://from-env:9000');
    });

    it('normalizes the prefix and rejects the root', () => {
      expect(Object.keys(canopyDevProxy({ basePath: 'api/canopy/' }))).toEqual(['/api/canopy']);
      expect(() => canopyDevProxy({ basePath: '/' })).toThrow(/non-root path/);
    });
  });

  describe('API key injection', () => {
    it('sets X-API-Key on proxied requests and WebSocket upgrades when a key is set', () => {
      const proxy = canopyDevProxy({ apiKey: 'dev', modules: ['/hare'], basePath: '/api/canopy' });
      for (const entry of Object.values(proxy)) {
        expect(headersSetBy(entry)).toEqual({
          http: { 'X-API-Key': 'dev' },
          ws: { 'X-API-Key': 'dev' },
        });
      }
    });

    it('falls back to CANOPY_API_KEY, and injects nothing without a key', () => {
      vi.stubEnv('CANOPY_API_KEY', 'env-key');
      expect(headersSetBy(canopyDevProxy()['/api/canopy']!).ws).toEqual({ 'X-API-Key': 'env-key' });

      // An explicit empty key overrides the env var: no header, no configure hook.
      const keyless = canopyDevProxy({ apiKey: '' })['/api/canopy']!;
      expect(keyless.configure).toBeUndefined();
      vi.stubEnv('CANOPY_API_KEY', '');
      expect(canopyDevProxy()['/api/canopy']!.configure).toBeUndefined();
    });
  });

  describe('modules mode', () => {
    it('forwards each module prefix unchanged (no rewrite) with ws enabled', () => {
      const proxy = canopyDevProxy({ target: 'http://t', modules: ['/hare', 'mole', '/fox/'] });

      expect(Object.keys(proxy)).toEqual(['/hare', '/mole', '/fox']);
      for (const entry of Object.values(proxy)) {
        expect(entry).toEqual({ target: 'http://t', changeOrigin: true, ws: true });
      }
    });

    it('can be combined with an explicit basePath', () => {
      expect(Object.keys(canopyDevProxy({ basePath: '/api', modules: ['/hare'] }))).toEqual([
        '/api',
        '/hare',
      ]);
    });
  });

  describe('elog', () => {
    it('forwards /elog to elog-plus with the prefix stripped and the access token injected', () => {
      const proxy = canopyDevProxy({
        elog: { target: 'https://elog.example.org', accessToken: 'tok' },
      });

      const entry = proxy['/elog']!;
      expect(entry).toMatchObject({ target: 'https://elog.example.org', changeOrigin: true });
      expect(entry.ws).toBeUndefined();
      expect(entry.rewrite!('/elog/v2/entries')).toBe('/v2/entries');
      expect(entry.rewrite!('/elog/v1/logbooks?x=1')).toBe('/v1/logbooks?x=1');
      // Only HTTP requests carry the token; the elog route has no WebSockets.
      expect(headersSetBy(entry)).toEqual({ http: { 'x-vouch-idp-accesstoken': 'tok' }, ws: {} });
      // The Canopy route never gets the elog token (and vice versa).
      expect(proxy['/api/canopy']!.configure).toBeUndefined();
    });

    it('reads ELOG_BASE_URL / ELOG_API_KEY, honours a custom path, and is omitted without a target', () => {
      expect(Object.keys(canopyDevProxy({ elog: {} }))).toEqual(['/api/canopy']);

      vi.stubEnv('ELOG_BASE_URL', 'http://elog:8080');
      vi.stubEnv('ELOG_API_KEY', 'env-tok');
      const entry = canopyDevProxy({ elog: { path: '/logbook' } })['/logbook']!;
      expect(entry.target).toBe('http://elog:8080');
      expect(entry.rewrite!('/logbook/v1/logbooks')).toBe('/v1/logbooks');
      expect(headersSetBy(entry).http).toEqual({ 'x-vouch-idp-accesstoken': 'env-tok' });

      // No token: forwarded without the header.
      vi.stubEnv('ELOG_API_KEY', '');
      expect(canopyDevProxy({ elog: {} })['/elog']!.configure).toBeUndefined();
    });
  });
});
