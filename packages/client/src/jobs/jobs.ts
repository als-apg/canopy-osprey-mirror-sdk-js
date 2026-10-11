// Client for Canopy's background-jobs API (`GET /jobs/v1/{jobId}`): a
// one-shot status fetch plus a polling helper that resolves/rejects on the
// job's terminal state.

import { abortReason } from '../rest/abort.js';
import { CanopyError, canopyFetch } from '../rest/canopyFetch.js';
import type { AbortSignalLike, CanopyConnection } from '../rest/canopyFetch.js';
import { isTerminalJobStatus } from './types.js';
import type { JobStatusDTO } from './types.js';

/** Poll the status / result of a background job by its id. */
export async function getJob(
  conn: CanopyConnection,
  id: string,
  signal?: AbortSignalLike
): Promise<JobStatusDTO> {
  return canopyFetch<JobStatusDTO>(conn, `/jobs/v1/${encodeURIComponent(id)}`, { signal });
}

/**
 * True for the 404 `job_not_found` error {@link getJob} throws when Canopy
 * has no record of the id: it was never enqueued there (mistyped, or from
 * another deployment), or the job finished and its result expired (results
 * are kept for the worker's `keep_result_s`, one hour by default). It means
 * "unknown", not "failed". A job waiting on any worker queue, the
 * optimization worker's included, reports `pending` instead; only Canopy
 * versions before commit daa584d answered 404 for a job queued on a
 * non-default queue.
 */
export function isJobNotFoundError(error: unknown): boolean {
  return error instanceof CanopyError && error.status === 404 && error.code === 'job_not_found';
}

/** Thrown by {@link awaitJob} when the job reaches the `failed` state. */
export class JobFailedError extends CanopyError {
  /** The job's final status snapshot (progress, message, error, ...). */
  readonly job: JobStatusDTO;

  constructor(job: JobStatusDTO) {
    super('job_failed', 0, job.error ?? `Job ${job.id} failed`);
    this.name = 'JobFailedError';
    this.job = job;
  }
}

export interface AwaitJobOptions {
  /** Delay between polls. Default 1000. */
  pollMs?: number;
  /**
   * Give up (with `CanopyError('job_timeout', ...)`) once this much time has
   * passed without the job reaching a terminal state. Default: no timeout.
   */
  timeoutMs?: number;
  /** Abort polling; rejects with the abort reason (an `AbortError` by default). */
  signal?: AbortSignalLike;
  /**
   * Keep polling through a 404 `job_not_found` (see {@link isJobNotFoundError})
   * until this long after the call started; after that the 404 is thrown.
   * Default 0: the first 404 is thrown, since current Canopy answers 404 only
   * for an unknown or expired job. A grace helps with older backends that
   * answered 404 while a job was still queued. `Infinity` never gives up on a
   * 404 (combine with `timeoutMs`).
   */
  notFoundGraceMs?: number;
}

/**
 * Poll `GET /jobs/v1/{id}` until the job reaches a terminal state.
 *
 * - Resolves with the final {@link JobStatusDTO} on `completed`.
 * - Rejects with {@link JobFailedError} on `failed`.
 * - Rejects with `CanopyError('job_timeout', 0, ...)` when `timeoutMs` elapses.
 * - Rejects with the abort reason when `signal` aborts (in-flight fetches
 *   pass their `AbortError` through; between polls the sleep is cut short).
 * - A 404 `job_not_found` (unknown id, or the result expired) rejects
 *   immediately, unless `notFoundGraceMs` allows waiting for the job to
 *   show up.
 */
export async function awaitJob(
  conn: CanopyConnection,
  id: string,
  options: AwaitJobOptions = {}
): Promise<JobStatusDTO> {
  const pollMs = options.pollMs ?? 1000;
  const { timeoutMs, signal } = options;
  const notFoundGraceMs = options.notFoundGraceMs ?? 0;
  const startedAt = Date.now();
  const deadline = timeoutMs !== undefined ? startedAt + timeoutMs : undefined;

  for (;;) {
    if (signal?.aborted) {
      throw abortReason(signal);
    }

    let job: JobStatusDTO | undefined;
    try {
      job = await getJob(conn, id, signal);
    } catch (err) {
      if (!isJobNotFoundError(err) || Date.now() - startedAt >= notFoundGraceMs) {
        throw err;
      }
    }
    if (job?.status === 'failed') {
      throw new JobFailedError(job);
    }
    if (job && isTerminalJobStatus(job.status)) {
      return job;
    }

    if (deadline === undefined) {
      await sleep(pollMs, signal);
      continue;
    }
    // Cap the last sleep to the remaining budget so the final poll lands on
    // the deadline instead of overshooting it by up to pollMs.
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      const state = job?.status ?? 'not found';
      throw new CanopyError('job_timeout', 0, `Job ${id} still ${state} after ${timeoutMs}ms`);
    }
    await sleep(Math.min(pollMs, remainingMs), signal);
  }
}

/** Abort-aware delay: resolves after `ms`, rejects immediately on abort. */
function sleep(ms: number, signal: AbortSignalLike | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    // addEventListener is optional on AbortSignalLike; without it, aborts
    // are still honored at the next loop iteration's aborted check.
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}
