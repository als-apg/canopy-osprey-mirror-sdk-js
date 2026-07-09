// Wire DTOs for Canopy's background-jobs API (`/jobs/v1/...`).
//
// These mirror Canopy's Python contracts (`canopy.contracts.jobs`,
// `canopy.jobs.schemas.job`), whose pydantic base (`CanopyModel`) serializes
// snake_case field names to camelCase on the wire.

/**
 * Lifecycle of a background job. `completed` and `failed` are the terminal
 * states; `pending`/`running` mean "poll again".
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

/** True when the job will never change state again. */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed';
}

/**
 * Returned by long-running operation endpoints when a job is enqueued
 * (`canopy.contracts.jobs.JobCreatedDTO`). Feed `jobId` to
 * {@link getJob} / {@link awaitJob}.
 */
export interface JobCreatedDTO {
  jobId: string;
  statusUrl: string | null;
}

/**
 * Status of a background job (`GET /jobs/v1/{jobId}`). `result` is an opaque
 * reference produced by the task (e.g. `{"type": "snapshot", "id": ...}`);
 * the Jobs module never interprets it, and neither does this client.
 * Timestamps are ISO-8601 strings.
 */
export interface JobStatusDTO {
  id: string;
  function: string | null;
  status: JobStatus;
  /** 0-100. */
  progress: number;
  message: string | null;
  result: unknown;
  error: string | null;
  enqueuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}
