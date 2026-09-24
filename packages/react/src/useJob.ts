import { useEffect, useState } from 'react';
import {
  CanopyError,
  getJob,
  isJobNotFoundError,
  isTerminalJobStatus,
} from '@slaclab/canopy-client';
import type { CanopyConnection, JobStatus, JobStatusDTO } from '@slaclab/canopy-client';
import { useCanopyConnection } from './canopyContext.js';

/**
 * What is known about a job:
 *
 * - `unknown`: the Jobs API answered 404 `job_not_found`: Canopy has no
 *   record of the id (mistyped, or from another deployment), or the job's
 *   result expired (after the worker's `keep_result_s`, one hour by
 *   default). It never means `failed`. A queued job, on any worker queue,
 *   is `pending`.
 * - `pending` / `running` / `completed` / `failed`: the job's own status.
 */
export type JobState = 'unknown' | JobStatus;

export interface UseJobOptions {
  /** Delay between polls while the job is pending/running. Default 1000. */
  pollMs?: number;
  /**
   * Polls back off (doubling from `pollMs`) while the job is `unknown` or a
   * poll failed transiently, up to this delay. Default 5000.
   */
  maxPollMs?: number;
  /**
   * After this long (from the first poll) with the job still `unknown`,
   * surface the 404 on `error` and stop polling. Default 30000 (30 s), a
   * margin for a job that is not visible yet; `0` surfaces the first 404
   * (the 0.1 behaviour), `Infinity` polls for as long as the component is
   * mounted.
   */
  notFoundGraceMs?: number;
}

export interface UseJobResult {
  /** Latest status snapshot for the current id; null until one arrives. */
  job: JobStatusDTO | null;
  /**
   * The last poll's error (usually a `CanopyError`), cleared by the next
   * successful poll. Transient failures (network, 5xx, 408, 429) keep
   * polling; any other error stops it, including a non-Canopy error such as
   * a missing `fetch` implementation.
   */
  error: Error | null;
  /** True while the first response for the current id is still in flight. */
  loading: boolean;
  /** See {@link JobState}; null without an id and until the first answer. */
  status: JobState | null;
}

/** What the last settled poll was for, so a stale id never leaks through. */
interface FetchedState {
  forId: string;
  job: JobStatusDTO | null;
  error: Error | null;
  status: JobState | null;
}

const DEFAULT_POLL_MS = 1000;
const DEFAULT_MAX_POLL_MS = 5000;
const DEFAULT_NOT_FOUND_GRACE_MS = 30_000;

/**
 * Failures worth retrying: no response, a server-side error, or a garbled
 * body. Anything that is not a `CanopyError` is a misuse (no `fetch`, a bad
 * id) that retrying cannot fix: `canopyFetch` turns every network-level
 * failure into a `CanopyError`.
 */
function isTransient(error: unknown): boolean {
  if (!(error instanceof CanopyError)) return false;
  if (error.code === 'invalid_json') return true;
  const { status } = error;
  return status === 0 || status >= 500 || status === 408 || status === 429;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Poll a Canopy background job (`GET /jobs/v1/{id}`) while mounted.
 *
 * Re-fetches every `pollMs` until the job reaches a terminal state
 * (`completed` / `failed`), the id changes, or the component unmounts; the
 * in-flight request is aborted on unmount and id change. A 404
 * `job_not_found` (unknown id, or the result expired) is reported as
 * `status: 'unknown'` and polled with backoff for `notFoundGraceMs`
 * (default 30 s), then surfaced on `error` and polling stops; transient
 * failures surface on `error`, keep the last `job`, and keep polling with
 * backoff; other errors (401, 403, 422, a non-Canopy error, ...) stop
 * polling. Pass `id: null` to render without a job (returns the idle
 * state).
 */
export function useJob(
  conn: CanopyConnection,
  id: string | null,
  options: UseJobOptions = {}
): UseJobResult {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const maxPollMs = Math.max(options.maxPollMs ?? DEFAULT_MAX_POLL_MS, pollMs);
  const notFoundGraceMs = options.notFoundGraceMs ?? DEFAULT_NOT_FOUND_GRACE_MS;
  // Depend on the connection's fields, not its identity, so an inline
  // `conn={{...}}` object literal does not restart polling every render.
  const { baseUrl, apiKey, fetch: fetchFn } = conn;

  const [fetched, setFetched] = useState<FetchedState | null>(null);

  useEffect(() => {
    if (id === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const connection: CanopyConnection = { baseUrl, apiKey, fetch: fetchFn };
    const startedAt = Date.now();
    let misses = 0;

    const schedule = (delayMs: number) => {
      timer = setTimeout(() => {
        void poll();
      }, delayMs);
    };
    // pollMs, 2x, 4x, ... capped at maxPollMs.
    const backoffMs = () => {
      misses += 1;
      return Math.min(maxPollMs, pollMs * 2 ** (misses - 1));
    };
    const previousJob = (previous: FetchedState | null) =>
      previous?.forId === id ? previous.job : null;

    const poll = async () => {
      let job: JobStatusDTO;
      try {
        job = await getJob(connection, id, controller.signal);
      } catch (err) {
        if (cancelled) return;
        if (isJobNotFoundError(err)) {
          const expired = Date.now() - startedAt >= notFoundGraceMs;
          setFetched((previous) => ({
            forId: id,
            job: previousJob(previous),
            error: expired ? toError(err) : null,
            status: 'unknown',
          }));
          if (!expired) schedule(backoffMs());
          return;
        }
        setFetched((previous) => ({
          forId: id,
          // Keep the last good snapshot (if it was for this id) next to the error.
          job: previousJob(previous),
          error: toError(err),
          status: previous?.forId === id ? previous.status : null,
        }));
        if (isTransient(err)) schedule(backoffMs());
        return;
      }
      if (cancelled) return;
      misses = 0;
      setFetched({ forId: id, job, error: null, status: job.status });
      if (!isTerminalJobStatus(job.status)) schedule(pollMs);
    };
    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [id, pollMs, maxPollMs, notFoundGraceMs, baseUrl, apiKey, fetchFn]);

  const current = id !== null && fetched?.forId === id ? fetched : null;
  return {
    job: current?.job ?? null,
    error: current?.error ?? null,
    loading: id !== null && current === null,
    status: current?.status ?? null,
  };
}

/**
 * {@link useJob} against the connection from the nearest `CanopyProvider`.
 */
export function useCanopyJob(id: string | null, options?: UseJobOptions): UseJobResult {
  return useJob(useCanopyConnection(), id, options);
}
