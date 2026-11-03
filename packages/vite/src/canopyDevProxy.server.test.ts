// End-to-end check of the proxy entries inside a real Vite dev server: that
// Vite consults `bypass` for WebSocket upgrades too, and what reaches the
// backend.

import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { canopyDevProxy } from './index.js';

interface Seen {
  kind: 'http' | 'ws';
  url: string;
  headers: IncomingHttpHeaders;
}

let backend: Server;
let vite: ViteDevServer;
let root: string;
let port: number;
const seen: Seen[] = [];
const sockets = new Set<Socket>();

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

beforeAll(async () => {
  backend = http.createServer((req, res) => {
    seen.push({ kind: 'http', url: req.url ?? '', headers: req.headers });
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
  backend.on('upgrade', (req, socket: Socket) => {
    seen.push({ kind: 'ws', url: req.url ?? '', headers: req.headers });
    sockets.add(socket);
    socket.on('error', () => {});
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'
    );
  });
  const backendPort = await listen(backend);

  root = await mkdtemp(join(tmpdir(), 'canopy-vite-'));
  vite = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port: 0,
      ws: false,
      watch: null,
      proxy: canopyDevProxy({
        target: `http://127.0.0.1:${backendPort}`,
        apiKey: 'dev-key',
        elogApiKey: 'elog-key',
        basePath: '/api/canopy',
        modules: ['/elog'],
      }),
    },
  });
  await vite.listen();
  port = (vite.httpServer!.address() as AddressInfo).port;
}, 30_000);

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await vite?.close();
  await new Promise((resolve) => backend?.close(resolve));
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  seen.length = 0;
});

function get(path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Attempt a WebSocket handshake; resolves with 101 when upgraded, else the refusal status. */
function upgrade(path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('canopyDevProxy in a Vite dev server', () => {
  const self = () => ({ Origin: `http://127.0.0.1:${port}` });

  it('proxies same-origin requests with the key, the prefix stripped and no cookies', async () => {
    const status = await get('/api/canopy/optimization/v1/runs?limit=5', {
      ...self(),
      Cookie: 'other-app-session=secret',
    });
    expect(status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('/optimization/v1/runs?limit=5');
    expect(seen[0]!.headers['x-api-key']).toBe('dev-key');
    expect(seen[0]!.headers.cookie).toBeUndefined();
  });

  it('proxies requests from non-browser clients (no Origin)', async () => {
    expect(await get('/api/canopy/health')).toBe(200);
    expect(seen[0]?.headers['x-api-key']).toBe('dev-key');
  });

  it('refuses cross-origin and cross-site requests before they reach the backend', async () => {
    expect(await get('/api/canopy/health', { Origin: 'https://evil.example' })).toBe(403);
    expect(await get('/api/canopy/health', { 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
    expect(seen).toEqual([]);
  });

  it('does not proxy a path that only shares the prefix text', async () => {
    await get('/api/canopy-foo/health', self());
    expect(seen).toEqual([]);
  });

  it('upgrades a same-origin WebSocket with the key and the prefix stripped', async () => {
    expect(await upgrade('/api/canopy/optimization/v1/ws/runs', self())).toBe(101);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'ws', url: '/optimization/v1/ws/runs' });
    expect(seen[0]!.headers['x-api-key']).toBe('dev-key');
  });

  it("sends elogApiKey to Canopy's e-log module in both modes, apiKey elsewhere", async () => {
    expect(await get('/api/canopy/elog/v1/apps/trace/config', self())).toBe(200);
    expect(await get('/elog/v1/apps/trace/logbooks', self())).toBe(200);
    expect(await get('/api/canopy/elogger', self())).toBe(200);
    expect(seen.map(({ url, headers }) => [url, headers['x-api-key']])).toEqual([
      ['/elog/v1/apps/trace/config', 'elog-key'],
      ['/elog/v1/apps/trace/logbooks', 'elog-key'],
      ['/elogger', 'dev-key'],
    ]);
  });

  it('refuses a cross-origin WebSocket upgrade', async () => {
    expect(
      await upgrade('/api/canopy/optimization/v1/ws/runs', { Origin: 'https://evil.example' })
    ).toBe(404);
    expect(seen).toEqual([]);
  });
});
