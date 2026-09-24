import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CanopyConnection, FetchLike, JobStatusDTO } from '@slaclab/canopy-client';
import { createFakeFetch, jsonResponse } from '@slaclab/canopy-client/testing';
import { CanopyProvider } from './CanopyProvider.js';
import { useCanopyConnection } from './canopyContext.js';
import { useCanopyJob, useJob } from './useJob.js';

function makeJob(overrides: Partial<JobStatusDTO> = {}): JobStatusDTO {
  return {
    id: 'job-1',
    function: 'restore_snapshot',
    status: 'pending',
    progress: 0,
    message: null,
    result: null,
    error: null,
    enqueuedAt: '2026-01-01T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

/** A fetch fake replaying one response per call (sticking on the last), keyed off nothing but call order. */
function makeConn(responses: Array<{ status?: number; body: unknown }>): {
  conn: CanopyConnection;
  fetchFn: ReturnType<typeof vi.fn>;
} {
  let call = 0;
  const fetchFn = vi.fn<FetchLike>(async () => {
    const response = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      text: async () => JSON.stringify(response.body),
    };
  });
  return { conn: { baseUrl: 'http://host', fetch: fetchFn }, fetchFn };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useJob', () => {
  it('is idle (not loading, no fetch) when id is null', async () => {
    const { conn, fetchFn } = makeConn([{ body: makeJob() }]);
    const { result } = renderHook(() => useJob(conn, null));

    await flush();

    expect(result.current).toEqual({ job: null, error: null, loading: false, status: null });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('polls while non-terminal, then stops on completed', async () => {
    const done = makeJob({ status: 'completed', progress: 100 });
    const { conn, fetchFn } = makeConn([
      { body: makeJob({ status: 'pending' }) },
      { body: makeJob({ status: 'running', progress: 50 }) },
      { body: done },
    ]);

    const { result } = renderHook(() => useJob(conn, 'job-1', { pollMs: 100 }));
    expect(result.current.loading).toBe(true);

    await flush();
    expect(result.current.loading).toBe(false);
    expect(result.current.job?.status).toBe('pending');

    await flush(100);
    expect(result.current.job?.status).toBe('running');

    await flush(100);
    expect(result.current.job).toEqual(done);

    // Terminal: no further polls, however long we wait.
    await flush(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('surfaces a fetch error and stops polling', async () => {
    const { conn, fetchFn } = makeConn([
      { body: makeJob({ status: 'running' }) },
      { status: 404, body: { code: 'not_found', detail: 'gone' } },
    ]);

    const { result } = renderHook(() => useJob(conn, 'job-1', { pollMs: 100 }));
    await flush();
    expect(result.current.job?.status).toBe('running');

    await flush(100);
    expect(result.current.error).toMatchObject({ name: 'CanopyError', code: 'not_found' });
    // The last good snapshot stays visible next to the error.
    expect(result.current.job?.status).toBe('running');

    await flush(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('resets to loading and refetches when the id changes', async () => {
    const { conn } = makeConn([
      { body: makeJob({ id: 'job-1', status: 'completed' }) },
      { body: makeJob({ id: 'job-2', status: 'running' }) },
    ]);

    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useJob(conn, id), {
      initialProps: { id: 'job-1' as string | null },
    });
    await flush();
    expect(result.current.job?.id).toBe('job-1');

    rerender({ id: 'job-2' });
    // The stale job-1 snapshot must not leak through while job-2 is in flight.
    expect(result.current).toMatchObject({ job: null, loading: true });

    await flush();
    expect(result.current.job?.id).toBe('job-2');
    expect(result.current.loading).toBe(false);

    rerender({ id: null });
    expect(result.current).toEqual({ job: null, error: null, loading: false, status: null });
  });

  it('stops polling on unmount', async () => {
    const { conn, fetchFn } = makeConn([{ body: makeJob({ status: 'pending' }) }]);

    const { unmount } = renderHook(() => useJob(conn, 'job-1', { pollMs: 100 }));
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    unmount();
    await flush(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('useJob status model', () => {
  const NOT_FOUND = jsonResponse(
    { code: 'job_not_found', detail: "Job 'job-1' not found" },
    { status: 404 }
  );

  it('mirrors job.status once the job is visible', async () => {
    const fetch = createFakeFetch({
      'GET /jobs/v1/:id': [
        jsonResponse(makeJob({ status: 'pending' })),
        jsonResponse(makeJob({ status: 'running' })),
        jsonResponse(makeJob({ status: 'failed', error: 'boom' })),
      ],
    });
    const { result } = renderHook(() =>
      useJob({ baseUrl: 'http://host', fetch }, 'job-1', { pollMs: 100 })
    );
    expect(result.current.status).toBeNull();

    await flush();
    expect(result.current.status).toBe('pending');
    await flush(100);
    expect(result.current.status).toBe('running');
    await flush(100);
    // A failed job is a status, not a polling error.
    expect(result.current).toMatchObject({ status: 'failed', error: null });
    expect(result.current.job?.error).toBe('boom');
  });

  it('reports a 404 job_not_found as unknown (not an error) and polls with backoff to 5 s', async () => {
    const fetch = createFakeFetch({
      'GET /jobs/v1/:id': [
        NOT_FOUND,
        NOT_FOUND,
        NOT_FOUND,
        NOT_FOUND,
        NOT_FOUND,
        jsonResponse(makeJob({ status: 'running' })),
        jsonResponse(makeJob({ status: 'completed' })),
      ],
    });
    const { result } = renderHook(() => useJob({ baseUrl: 'http://host', fetch }, 'job-1'));

    await flush();
    expect(result.current).toEqual({ job: null, error: null, loading: false, status: 'unknown' });

    // Backoff: 1000, 2000, 4000, 5000 (capped) ...
    await flush(999);
    expect(fetch.calls).toHaveLength(1);
    await flush(1);
    expect(fetch.calls).toHaveLength(2);
    await flush(2000);
    expect(fetch.calls).toHaveLength(3);
    await flush(4000);
    expect(fetch.calls).toHaveLength(4);
    await flush(5000);
    expect(fetch.calls).toHaveLength(5);
    expect(result.current.status).toBe('unknown');
    expect(result.current.error).toBeNull();

    await flush(5000); // the job finally shows up
    expect(result.current.status).toBe('running');
    await flush(1000); // back to the normal poll interval
    expect(result.current.status).toBe('completed');
  });

  it('by default turns an unknown lasting 30 s into an error, then stops', async () => {
    const fetch = createFakeFetch({ 'GET /jobs/v1/:id': NOT_FOUND });
    const { result } = renderHook(() => useJob({ baseUrl: 'http://host', fetch }, 'job-1'));

    // Polls at 0, 1, 3, 7, 12, 17, 22, 27 s: still inside the grace.
    await flush(29_000);
    expect(result.current).toMatchObject({ status: 'unknown', error: null });
    expect(fetch.calls).toHaveLength(8);

    await flush(3_000); // the poll at 32 s is past it
    expect(result.current.status).toBe('unknown');
    expect(result.current.error).toMatchObject({ name: 'CanopyError', code: 'job_not_found' });

    await flush(60_000);
    expect(fetch.calls).toHaveLength(9);
  });

  it('notFoundGraceMs: Infinity keeps polling an unknown job while mounted', async () => {
    const fetch = createFakeFetch({ 'GET /jobs/v1/:id': NOT_FOUND });
    const { result } = renderHook(() =>
      useJob({ baseUrl: 'http://host', fetch }, 'job-1', { notFoundGraceMs: Infinity })
    );

    await flush(10 * 60_000);
    expect(result.current).toMatchObject({ status: 'unknown', error: null });
    expect(fetch.calls.length).toBeGreaterThan(100);
  });

  it('turns a lasting unknown into an error after notFoundGraceMs, then stops', async () => {
    const fetch = createFakeFetch({ 'GET /jobs/v1/:id': NOT_FOUND });
    const { result } = renderHook(() =>
      useJob({ baseUrl: 'http://host', fetch }, 'job-1', {
        pollMs: 100,
        maxPollMs: 100,
        notFoundGraceMs: 250,
      })
    );

    await flush(200);
    expect(result.current).toMatchObject({ status: 'unknown', error: null });

    await flush(100); // poll at t=300 is past the grace
    expect(result.current.status).toBe('unknown');
    expect(result.current.error).toMatchObject({ name: 'CanopyError', code: 'job_not_found' });

    const polls = fetch.calls.length;
    await flush(10_000);
    expect(fetch.calls).toHaveLength(polls);
  });

  it('keeps polling through transient errors, surfacing them next to the last job', async () => {
    const fetch = createFakeFetch({
      'GET /jobs/v1/:id': [
        jsonResponse(makeJob({ status: 'running', progress: 10 })),
        () => {
          throw new Error('connection reset');
        },
        jsonResponse({ code: 'unhandled_exception', detail: 'Redis down' }, { status: 500 }),
        jsonResponse(makeJob({ status: 'running', progress: 60 })),
      ],
    });
    const { result } = renderHook(() =>
      useJob({ baseUrl: 'http://host', fetch }, 'job-1', { pollMs: 100 })
    );

    await flush();
    await flush(100); // network failure
    expect(result.current.error).toMatchObject({ code: 'network_error' });
    expect(result.current).toMatchObject({ status: 'running', job: { progress: 10 } });

    await flush(100); // backoff 100 -> 500
    expect(result.current.error).toMatchObject({ code: 'unhandled_exception', status: 500 });

    await flush(200); // backoff 200 -> recovered
    expect(result.current).toMatchObject({ error: null, status: 'running', job: { progress: 60 } });
    expect(fetch.calls).toHaveLength(4);
  });

  it('stops on an error that is not a CanopyError (no fetch implementation)', async () => {
    vi.stubGlobal('fetch', undefined);
    try {
      const { result } = renderHook(() =>
        useJob({ baseUrl: 'http://host' }, 'job-1', { pollMs: 100 })
      );
      await flush();
      expect(result.current.error?.message).toMatch(/no fetch implementation/);
      expect(result.current).toMatchObject({ status: null, job: null, loading: false });

      // Retrying cannot help: no further poll, even once a fetch exists.
      const fetchFn = vi.fn<FetchLike>();
      vi.stubGlobal('fetch', fetchFn);
      await flush(60_000);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('aborts the in-flight request on unmount and on id change', async () => {
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as unknown as { signal: AbortSignal }).signal;
          signals.push(signal);
          signal.addEventListener('abort', () => reject(signal.reason));
        })
    );
    const conn: CanopyConnection = { baseUrl: 'http://host', fetch: fetchFn };

    const { rerender, unmount, result } = renderHook(({ id }: { id: string }) => useJob(conn, id), {
      initialProps: { id: 'job-1' },
    });
    await flush();
    expect(signals).toHaveLength(1);

    rerender({ id: 'job-2' });
    await flush();
    expect(signals[0]!.aborted).toBe(true);
    expect(signals).toHaveLength(2);

    unmount();
    expect(signals[1]!.aborted).toBe(true);
    // The aborted requests never surface as errors.
    expect(result.current.error).toBeNull();
  });
});

describe('CanopyProvider + useCanopyJob', () => {
  it('polls through the provided connection', async () => {
    const fetch = createFakeFetch(
      { 'GET /jobs/v1/:id': jsonResponse(makeJob({ status: 'completed' })) },
      { baseUrl: '/api/canopy' }
    );
    const connection: CanopyConnection = { baseUrl: '/api/canopy', apiKey: 'k', fetch };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CanopyProvider connection={connection}>{children}</CanopyProvider>
    );

    const { result } = renderHook(() => useCanopyJob('job 7'), { wrapper });
    await flush();

    expect(result.current.status).toBe('completed');
    expect(fetch.calls[0]).toMatchObject({
      url: '/api/canopy/jobs/v1/job%207',
      headers: { 'X-API-Key': 'k' },
    });
  });

  it('useCanopyConnection returns the connection and throws outside the provider', () => {
    const connection: CanopyConnection = { baseUrl: '/api/canopy' };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CanopyProvider connection={connection}>{children}</CanopyProvider>
    );
    expect(renderHook(() => useCanopyConnection(), { wrapper }).result.current).toBe(connection);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useCanopyJob('x'))).toThrow(/CanopyProvider/);
    consoleError.mockRestore();
  });
});
