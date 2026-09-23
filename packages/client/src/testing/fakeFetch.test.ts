import { describe, expect, it } from 'vitest';
import { canopyFetch } from '../rest/canopyFetch.js';
import type { AbortSignalLike } from '../rest/canopyFetch.js';
import { createFakeFetch, jsonResponse } from './index.js';

function makeAbortController(): { signal: AbortSignalLike; abort(): void } {
  const listeners = new Set<() => void>();
  const signal = {
    aborted: false,
    reason: undefined as unknown,
    addEventListener: (_type: 'abort', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'abort', listener: () => void) => listeners.delete(listener),
  };
  return {
    signal,
    abort() {
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('jsonResponse', () => {
  it('serializes the body and derives ok from the status', async () => {
    const ok = jsonResponse({ a: 1 });
    expect(ok.ok).toBe(true);
    expect(ok.status).toBe(200);
    await expect(ok.text()).resolves.toBe('{"a":1}');

    const missing = jsonResponse({ detail: 'x' }, { status: 404 });
    expect(missing.ok).toBe(false);

    await expect(jsonResponse(undefined, { status: 204 }).text()).resolves.toBe('');
  });
});

describe('createFakeFetch', () => {
  it('matches method + path routes, exposes :params, and records every call', async () => {
    const fetch = createFakeFetch({
      'GET /jobs/v1/:id': (req) => jsonResponse({ id: req.params.id, status: 'running' }),
      'POST /optimization/v1/runs': (req) =>
        jsonResponse({ id: 'r1', echo: req.json }, { status: 201 }),
    });
    const conn = { baseUrl: 'http://canopy/', apiKey: 'k', fetch };

    await expect(canopyFetch(conn, '/jobs/v1/job%201')).resolves.toEqual({
      id: 'job 1',
      status: 'running',
    });
    await expect(
      canopyFetch(conn, '/optimization/v1/runs', {
        method: 'POST',
        body: { routineId: 'x' },
        query: { dryRun: true, q: 'a b' },
      })
    ).resolves.toEqual({ id: 'r1', echo: { routineId: 'x' } });

    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[1]).toMatchObject({
      method: 'POST',
      url: 'http://canopy/optimization/v1/runs?dryRun=true&q=a%20b',
      path: '/optimization/v1/runs',
      query: { dryRun: 'true', q: 'a b' },
      body: '{"routineId":"x"}',
      json: { routineId: 'x' },
      headers: { 'X-API-Key': 'k', 'Content-Type': 'application/json' },
    });
  });

  it('replays a sequence one response per call, repeating the last', async () => {
    const fetch = createFakeFetch({
      '/jobs/v1/j': [jsonResponse({ status: 'pending' }), jsonResponse({ status: 'completed' })],
    });
    const conn = { baseUrl: 'http://canopy', fetch };
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await canopyFetch<{ status: string }>(conn, '/jobs/v1/j')).status);
    }
    expect(statuses).toEqual(['pending', 'completed', 'completed']);
  });

  it('a path-only route answers any method; method routes are exact', async () => {
    const fetch = createFakeFetch({
      'DELETE /runs/:id': jsonResponse(undefined, { status: 204 }),
      '/runs/:id': jsonResponse({ any: true }),
    });
    const conn = { baseUrl: 'http://canopy', fetch };
    await expect(canopyFetch(conn, '/runs/1', { method: 'DELETE' })).resolves.toBeUndefined();
    await expect(canopyFetch(conn, '/runs/1', { method: 'PATCH', body: {} })).resolves.toEqual({
      any: true,
    });
  });

  it('answers unmatched requests with a FastAPI-style 404 (canopyFetch: not_found)', async () => {
    const fetch = createFakeFetch({ 'GET /a': jsonResponse(1) });
    await expect(canopyFetch({ baseUrl: 'http://canopy', fetch }, '/b')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      detail: 'No fake route for GET /b',
    });
    expect(fetch.calls.map((call) => call.path)).toEqual(['/b']);
  });

  it('strips a baseUrl prefix (relative or absolute) before matching', async () => {
    const relative = createFakeFetch(
      { 'GET /health': jsonResponse('ok') },
      { baseUrl: '/api/canopy/' }
    );
    await expect(canopyFetch({ baseUrl: '/api/canopy', fetch: relative }, '/health')).resolves.toBe(
      'ok'
    );

    const absolute = createFakeFetch(
      { 'GET /health': jsonResponse('ok') },
      { baseUrl: 'https://host/prefix' }
    );
    await expect(
      canopyFetch({ baseUrl: 'https://host/prefix', fetch: absolute }, '/health')
    ).resolves.toBe('ok');
  });

  it('a throwing handler surfaces as a network error', async () => {
    const fetch = createFakeFetch({
      '/x': () => {
        throw new Error('connection refused');
      },
    });
    await expect(canopyFetch({ baseUrl: 'http://h', fetch }, '/x')).rejects.toMatchObject({
      code: 'network_error',
      detail: 'connection refused',
    });
  });

  it('honours an abort signal before and during the request', async () => {
    let release!: () => void;
    const fetch = createFakeFetch({
      '/slow': () =>
        new Promise((resolve) => {
          release = () => resolve(jsonResponse('late'));
        }),
      '/fast': jsonResponse('fast'),
    });
    const conn = { baseUrl: 'http://h', fetch };

    const pre = makeAbortController();
    pre.abort();
    await expect(canopyFetch(conn, '/fast', { signal: pre.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });

    const mid = makeAbortController();
    const pending = canopyFetch(conn, '/slow', { signal: mid.signal });
    mid.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    release();
  });

  it('set() adds or replaces a route mid-test', async () => {
    const fetch = createFakeFetch({ 'GET /v': jsonResponse(1) });
    const conn = { baseUrl: 'http://h', fetch };
    await expect(canopyFetch(conn, '/v')).resolves.toBe(1);
    fetch.set('GET /v', jsonResponse(2));
    fetch.set('GET /w', jsonResponse(3));
    await expect(canopyFetch(conn, '/v')).resolves.toBe(2);
    await expect(canopyFetch(conn, '/w')).resolves.toBe(3);
  });
});
