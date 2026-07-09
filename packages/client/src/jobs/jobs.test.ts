import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../hare/HarePVService.js';
import type { AbortSignalLike, CanopyConnection } from '../rest/canopyFetch.js';
import { JobFailedError, awaitJob, getJob } from './jobs.js';
import type { JobStatusDTO } from './types.js';

/**
 * Minimal AbortController stand-in implementing `AbortSignalLike` (the real
 * one belongs to the DOM/Node type universes this package compiles without).
 */
function makeAbortController(): { signal: AbortSignalLike; abort(): void } {
  const listeners = new Set<() => void>();
  const signal: {
    aborted: boolean;
    reason: unknown;
    addEventListener(type: 'abort', listener: () => void): void;
    removeEventListener(type: 'abort', listener: () => void): void;
  } = {
    aborted: false,
    reason: undefined,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    signal,
    abort() {
      if (signal.aborted) return;
      signal.aborted = true;
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      signal.reason = error;
      for (const listener of [...listeners]) listener();
    },
  };
}

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

/** A fetch fake that replays `responses` in order, sticking on the last one. */
function makeSequenceConn(responses: Array<{ status?: number; body: unknown }>): {
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
  return { conn: { baseUrl: 'http://host', apiKey: 'secret-key', fetch: fetchFn }, fetchFn };
}

describe('getJob', () => {
  it('GETs /jobs/v1/{id} with X-API-Key and returns the status DTO', async () => {
    const job = makeJob({ status: 'running', progress: 40, message: 'restoring' });
    const { conn, fetchFn } = makeSequenceConn([{ body: job }]);

    await expect(getJob(conn, 'job-1')).resolves.toEqual(job);

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://host/jobs/v1/job-1');
    expect(init.method).toBe('GET');
    expect(init.headers['X-API-Key']).toBe('secret-key');
  });

  it('surfaces the backend envelope as CanopyError (e.g. unknown job id)', async () => {
    const { conn } = makeSequenceConn([
      { status: 404, body: { code: 'not_found', detail: "Job 'nope' not found" } },
    ]);

    await expect(getJob(conn, 'nope')).rejects.toMatchObject({
      name: 'CanopyError',
      code: 'not_found',
      status: 404,
    });
  });
});

describe('awaitJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls on pollMs until the job completes, then resolves with the final DTO', async () => {
    const done = makeJob({ status: 'completed', progress: 100, result: { id: 7 } });
    const { conn, fetchFn } = makeSequenceConn([
      { body: makeJob({ status: 'pending' }) },
      { body: makeJob({ status: 'running', progress: 50 }) },
      { body: done },
    ]);

    const promise = awaitJob(conn, 'job-1', { pollMs: 100 });
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).resolves.toEqual(done);
    expect(fetchFn).toHaveBeenCalledTimes(3); // t=0, t=100, t=200 — then stops
  });

  it('rejects with JobFailedError carrying the final DTO when the job fails', async () => {
    const failed = makeJob({ status: 'failed', error: 'device refused the write' });
    const { conn } = makeSequenceConn([{ body: makeJob({ status: 'running' }) }, { body: failed }]);

    const promise = awaitJob(conn, 'job-1', { pollMs: 100 });
    promise.catch(() => {}); // avoid unhandled-rejection noise while timers advance
    await vi.advanceTimersByTimeAsync(100);

    const error = await promise.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(JobFailedError);
    const jobError = error as JobFailedError;
    expect(jobError.code).toBe('job_failed');
    expect(jobError.detail).toBe('device refused the write');
    expect(jobError.job).toEqual(failed);
  });

  it('rejects with CanopyError(job_timeout) when timeoutMs elapses without a terminal state', async () => {
    const { conn, fetchFn } = makeSequenceConn([{ body: makeJob({ status: 'running' }) }]);

    const promise = awaitJob(conn, 'job-1', { pollMs: 100, timeoutMs: 250 });
    promise.catch(() => {});
    // Polls at t=0/100/200, then a final deadline-capped poll at t=250.
    await vi.advanceTimersByTimeAsync(250);

    await expect(promise).rejects.toMatchObject({
      name: 'CanopyError',
      code: 'job_timeout',
      status: 0,
      detail: 'Job job-1 still running after 250ms',
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('stops polling and rejects with the abort reason when the signal aborts mid-sleep', async () => {
    const { conn, fetchFn } = makeSequenceConn([{ body: makeJob({ status: 'pending' }) }]);

    const controller = makeAbortController();
    const promise = awaitJob(conn, 'job-1', { pollMs: 1000, signal: controller.signal });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0); // first poll settles, sleep starts

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(1); // no polls after the abort
  });
});
