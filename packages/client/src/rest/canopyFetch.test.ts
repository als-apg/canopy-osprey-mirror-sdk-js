import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../hare/HarePVService.js';
import { CanopyError, canopyFetch } from './canopyFetch.js';
import type { CanopyConnection } from './canopyFetch.js';

function makeFetchMock(response: { ok: boolean; status: number; text?: string }) {
  return vi.fn<FetchLike>(async () => ({
    ok: response.ok,
    status: response.status,
    text: async () => response.text ?? '',
  }));
}

const BASE_URL = 'http://host';

describe('canopyFetch', () => {
  it('GETs baseUrl + path with query params, an Accept header, and X-API-Key when configured', async () => {
    const fetchFn = makeFetchMock({ ok: true, status: 200, text: '{"pvs":[]}' });
    const conn: CanopyConnection = { baseUrl: BASE_URL, apiKey: 'secret-key', fetch: fetchFn };

    const result = await canopyFetch<{ pvs: string[] }>(conn, '/mole/v1/search', {
      query: { pattern: 'BPMS.*', archiver: undefined, limit: 5, exact: false },
    });

    expect(result).toEqual({ pvs: [] });
    const [url, init] = fetchFn.mock.calls[0]!;
    // undefined/null query entries are skipped; the rest are stringified.
    expect(url).toBe('http://host/mole/v1/search?pattern=BPMS.*&limit=5&exact=false');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Accept: 'application/json', 'X-API-Key': 'secret-key' });
    expect(init.body).toBeUndefined();
  });

  it('tolerates a trailing slash on baseUrl and omits X-API-Key without an apiKey', async () => {
    const fetchFn = makeFetchMock({ ok: true, status: 200, text: 'null' });
    await canopyFetch({ baseUrl: 'http://host/', fetch: fetchFn }, '/jobs/v1/abc');

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://host/jobs/v1/abc');
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('JSON-serializes `body` with the given method and sets Content-Type', async () => {
    const fetchFn = makeFetchMock({ ok: true, status: 200, text: '{"pv":"X"}' });
    await canopyFetch(
      { baseUrl: BASE_URL, fetch: fetchFn },
      '/hare/v1/pvs/X',
      { method: 'PUT', body: { value: 3.2, wait: false } } // key order preserved in the wire body
    );

    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"value":3.2,"wait":false}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws CanopyError carrying the {code, detail} envelope on a non-ok response', async () => {
    const fetchFn = makeFetchMock({
      ok: false,
      status: 404,
      text: '{"code":"not_found","detail":"PV not archived"}',
    });

    const error = await canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/mole/v1/x').catch(
      (err: unknown) => err
    );

    expect(error).toBeInstanceOf(CanopyError);
    const canopyError = error as CanopyError;
    expect(canopyError.code).toBe('not_found');
    expect(canopyError.status).toBe(404);
    expect(canopyError.detail).toBe('PV not archived');
    expect(canopyError.message).toBe('not_found (404): PV not archived');
  });

  it('falls back to the raw body text (or HTTP status) when the error body is not an envelope', async () => {
    const fetchFn = makeFetchMock({ ok: false, status: 502, text: 'Bad Gateway' });
    await expect(canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x')).rejects.toMatchObject({
      code: 'unknown_error',
      status: 502,
      detail: 'Bad Gateway',
    });

    const emptyFetch = makeFetchMock({ ok: false, status: 500 });
    await expect(canopyFetch({ baseUrl: BASE_URL, fetch: emptyFetch }, '/x')).rejects.toMatchObject(
      { code: 'unknown_error', status: 500, detail: 'HTTP 500' }
    );
  });

  it('normalizes network-level failures to CanopyError(network_error, 0)', async () => {
    const fetchFn: FetchLike = vi.fn(async () => {
      throw new Error('connection refused');
    });

    await expect(canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x')).rejects.toMatchObject({
      name: 'CanopyError',
      code: 'network_error',
      status: 0,
      detail: 'connection refused',
    });
  });

  it('passes AbortError through unchanged instead of wrapping it', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const fetchFn: FetchLike = vi.fn(async () => {
      throw abortError;
    });

    const caught = await canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x').catch(
      (err: unknown) => err
    );
    expect(caught).toBe(abortError);
  });

  it('resolves undefined for an empty 2xx body', async () => {
    const fetchFn = makeFetchMock({ ok: true, status: 204 });
    await expect(canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x')).resolves.toBeUndefined();
  });
});
