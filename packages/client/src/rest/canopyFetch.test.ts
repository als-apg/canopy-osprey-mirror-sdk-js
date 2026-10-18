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
      query: { pattern: 'DEMO.*', archiver: undefined, limit: 5, exact: false },
    });

    expect(result).toEqual({ pvs: [] });
    const [url, init] = fetchFn.mock.calls[0]!;
    // undefined/null query entries are skipped; the rest are stringified.
    expect(url).toBe('http://host/mole/v1/search?pattern=DEMO.*&limit=5&exact=false');
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

  it('normalizes a body that fails mid-read to network_error, but passes an abort through', async () => {
    const failingBody = (error: Error): FetchLike =>
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw error;
        },
      }));

    await expect(
      canopyFetch({ baseUrl: BASE_URL, fetch: failingBody(new TypeError('terminated')) }, '/x')
    ).rejects.toMatchObject({ name: 'CanopyError', code: 'network_error', status: 0 });

    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    await expect(canopyFetch({ baseUrl: BASE_URL, fetch: failingBody(abort) }, '/x')).rejects.toBe(
      abort
    );
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

  it("passes an aborted signal's own reason through (custom reason, TimeoutError)", async () => {
    // Real fetch rejects with `signal.reason` when one was given, whatever
    // its name; it must not be rewrapped as network_error.
    const abortWith = (reason: Error) => {
      const signal = { aborted: false, reason: undefined as unknown };
      const fetchFn: FetchLike = vi.fn(async () => {
        signal.aborted = true;
        signal.reason = reason;
        throw reason;
      });
      return canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x', { signal }).catch(
        (err: unknown) => err
      );
    };

    const custom = new Error('user navigated away');
    expect(await abortWith(custom)).toBe(custom);

    const timeout = new Error('signal timed out');
    timeout.name = 'TimeoutError';
    expect(await abortWith(timeout)).toBe(timeout);
  });

  it('still wraps a failure as network_error while the signal has not aborted', async () => {
    const fetchFn: FetchLike = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x', { signal: { aborted: false } })
    ).rejects.toMatchObject({ name: 'CanopyError', code: 'network_error', status: 0 });
  });

  it('resolves undefined for an empty 2xx body', async () => {
    const fetchFn = makeFetchMock({ ok: true, status: 204 });
    await expect(canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x')).resolves.toBeUndefined();
  });
});

describe('canopyFetch error normalization (FastAPI bodies without a code)', () => {
  async function errorFor(status: number, text: string): Promise<CanopyError> {
    const fetchFn = makeFetchMock({ ok: false, status, text });
    const error = await canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x').catch(
      (err: unknown) => err
    );
    expect(error).toBeInstanceOf(CanopyError);
    return error as CanopyError;
  }

  it('maps a request-validation array to validation_error with issues and a readable detail', async () => {
    const error = await errorFor(
      422,
      JSON.stringify({
        detail: [
          {
            type: 'literal_error',
            loc: ['body', 'action'],
            msg: "Input should be 'pause', 'resume' or 'stop'",
            input: 'explode',
            ctx: { expected: "'pause', 'resume' or 'stop'" },
          },
          {
            type: 'value_error',
            loc: ['body', 'variables', 0, 'lower'],
            msg: 'Value error, lower > upper',
          },
        ],
      })
    );

    expect(error.code).toBe('validation_error');
    expect(error.status).toBe(422);
    expect(error.detail).toBe(
      "body.action: Input should be 'pause', 'resume' or 'stop'; body.variables[0].lower: Value error, lower > upper"
    );
    expect(error.message).toBe(`validation_error (422): ${error.detail}`);
    expect(error.issues).toEqual([
      {
        loc: ['body', 'action'],
        msg: "Input should be 'pause', 'resume' or 'stop'",
        type: 'literal_error',
        input: 'explode',
        ctx: { expected: "'pause', 'resume' or 'stop'" },
      },
      {
        loc: ['body', 'variables', 0, 'lower'],
        msg: 'Value error, lower > upper',
        type: 'value_error',
      },
    ]);
  });

  it('normalizes malformed validation entries instead of leaking objects into detail', async () => {
    const error = await errorFor(422, JSON.stringify({ detail: ['plain text', { weird: 1 }] }));
    expect(error.issues).toEqual([
      { loc: [], msg: 'plain text', type: 'unknown' },
      { loc: [], msg: '{"weird":1}', type: 'unknown' },
    ]);
    expect(error.detail).toBe('plain text; {"weird":1}');

    const empty = await errorFor(422, '{"detail":[]}');
    expect(empty.detail).toBe('Request validation failed');
    expect(empty.issues).toEqual([]);
  });

  it('maps a bare string detail to not_found for 404 and http_error otherwise', async () => {
    await expect(errorFor(404, '{"detail":"Not Found"}')).resolves.toMatchObject({
      code: 'not_found',
      status: 404,
      detail: 'Not Found',
      issues: undefined,
    });
    await expect(errorFor(405, '{"detail":"Method Not Allowed"}')).resolves.toMatchObject({
      code: 'http_error',
      status: 405,
      detail: 'Method Not Allowed',
    });
  });

  it('stringifies a structured (non-array) detail', async () => {
    const error = await errorFor(400, '{"detail":{"reason":"bad","field":"x"}}');
    expect(error.code).toBe('http_error');
    expect(error.detail).toBe('{"reason":"bad","field":"x"}');
  });

  it('keeps an envelope code even when the detail is missing or an array', async () => {
    await expect(errorFor(409, '{"code":"run_invalid_state"}')).resolves.toMatchObject({
      code: 'run_invalid_state',
      detail: '{"code":"run_invalid_state"}',
    });
    const withIssues = await errorFor(
      422,
      '{"code":"routine_invalid","detail":[{"loc":["body"],"msg":"m","type":"t"}]}'
    );
    expect(withIssues.code).toBe('routine_invalid');
    expect(withIssues.detail).toBe('body: m');
  });

  it('falls back to unknown_error with the raw text for JSON that is not an object', async () => {
    await expect(errorFor(500, '"oops"')).resolves.toMatchObject({
      code: 'unknown_error',
      detail: '"oops"',
    });
    await expect(errorFor(500, '{"message":"boom"}')).resolves.toMatchObject({
      code: 'unknown_error',
      detail: '{"message":"boom"}',
    });
  });

  it('CanopyError.detail is always a string', () => {
    const error = new CanopyError('x', 400, [{ a: 1 }] as unknown as string);
    expect(error.detail).toBe('[{"a":1}]');
    expect(error.message).toBe('x (400): [{"a":1}]');
    expect(new CanopyError('x', 400, 'plain').issues).toBeUndefined();

    // JSON.stringify gives undefined for these; detail must still be a string.
    const missing = new CanopyError('x', 500, undefined as unknown as string);
    expect(missing.detail).toBe('undefined');
    expect(missing.message).toBe('x (500): undefined');
    expect(typeof new CanopyError('x', 500, (() => 1) as unknown as string).detail).toBe('string');
  });
});

describe('canopyFetch FormData bodies', () => {
  type FormDataLike = { append(name: string, value: string): void };
  const FormDataCtor = (globalThis as unknown as { FormData: new () => FormDataLike }).FormData;

  it('passes a FormData body through untouched, without a JSON Content-Type', async () => {
    const fetchFn = makeFetchMock({ ok: true, status: 201, text: '{"id":"e1"}' });
    const form = new FormDataCtor();
    form.append('title', 'Run summary');

    const result = await canopyFetch(
      { baseUrl: BASE_URL, apiKey: 'k', fetch: fetchFn },
      '/v2/entries',
      { method: 'POST', body: form }
    );

    expect(result).toEqual({ id: 'e1' });
    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(form);
    expect(init.headers).toEqual({ Accept: 'application/json', 'X-API-Key': 'k' });
  });

  it('recognizes a FormData from another realm by its toStringTag', async () => {
    const fetchFn = makeFetchMock({ ok: true, status: 204 });
    const foreign = { [Symbol.toStringTag]: 'FormData', append() {} };

    await canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x', {
      method: 'POST',
      body: foreign,
    });

    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.body).toBe(foreign);
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('still JSON-serializes plain objects, arrays and strings', async () => {
    const fetchFn = makeFetchMock({ ok: true, status: 204 });
    await canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x', { method: 'POST', body: 'a' });
    await canopyFetch({ baseUrl: BASE_URL, fetch: fetchFn }, '/x', { method: 'POST', body: [1] });

    expect(fetchFn.mock.calls.map(([, init]) => init.body)).toEqual(['"a"', '[1]']);
  });
});
