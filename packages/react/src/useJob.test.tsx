import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { CanopyConnection, FetchLike, JobStatusDTO } from '@slaclab/canopy-client';
import { useJob } from './useJob.js';

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

    expect(result.current).toEqual({ job: null, error: null, loading: false });
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
    expect(result.current).toEqual({ job: null, error: null, loading: false });
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
