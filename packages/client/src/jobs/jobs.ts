// Client for Canopy's background-jobs API (`GET /jobs/v1/{jobId}`): a
// one-shot status fetch plus a polling helper that resolves/rejects on the
// job's terminal state.

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
}

/**
 * Poll `GET /jobs/v1/{id}` until the job reaches a terminal state.
 *
 * - Resolves with the final {@link JobStatusDTO} on `completed`.
 * - Rejects with {@link JobFailedError} on `failed`.
 * - Rejects with `CanopyError('job_timeout', 0, ...)` when `timeoutMs` elapses.
 * - Rejects with the abort reason when `signal` aborts (in-flight fetches
 *   pass their `AbortError` through; between polls the sleep is cut short).
 */
export async function awaitJob(
  conn: CanopyConnection,
  id: string,
  options: AwaitJobOptions = {}
): Promise<JobStatusDTO> {
  const pollMs = options.pollMs ?? 1000;
  const { timeoutMs, signal } = options;
  const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;

  for (;;) {
    if (signal?.aborted) {
      throw abortReason(signal);
    }

    const job = await getJob(conn, id, signal);
    if (job.status === 'failed') {
      throw new JobFailedError(job);
    }
    if (isTerminalJobStatus(job.status)) {
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
      throw new CanopyError('job_timeout', 0, `Job ${id} still ${job.status} after ${timeoutMs}ms`);
    }
    await sleep(Math.min(pollMs, remainingMs), signal);
  }
}

/** The signal's abort reason, or a synthetic `AbortError` when none was given. */
function abortReason(signal: AbortSignalLike): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
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
