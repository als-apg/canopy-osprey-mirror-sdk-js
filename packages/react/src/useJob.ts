import { useEffect, useState } from 'react';
import { getJob, isTerminalJobStatus } from '@slaclab/canopy-client';
import type { CanopyConnection, JobStatusDTO } from '@slaclab/canopy-client';

export interface UseJobOptions {
  /** Delay between polls while the job is non-terminal. Default 1000. */
  pollMs?: number;
}

export interface UseJobResult {
  /** Latest status for the current id; null until the first response. */
  job: JobStatusDTO | null;
  /** The fetch error that stopped polling, if any (usually a `CanopyError`). */
  error: Error | null;
  /** True while the first response for the current id is still in flight. */
  loading: boolean;
}

/** What the last settled fetch was for, so a stale id never leaks through. */
interface FetchedState {
  forId: string;
  job: JobStatusDTO | null;
  error: Error | null;
}

/**
 * Poll a Canopy background job (`GET /jobs/v1/{id}`) while mounted.
 *
 * Re-fetches every `pollMs` until the job reaches a terminal state
 * (`completed` / `failed` — inspect `job.status`), the id changes, or the
 * component unmounts. A fetch error is surfaced on `error` and stops
 * polling. Pass `id: null` to render without a job (returns the idle state).
 */
export function useJob(
  conn: CanopyConnection,
  id: string | null,
  options: UseJobOptions = {}
): UseJobResult {
  const pollMs = options.pollMs ?? 1000;
  // Depend on the connection's fields, not its identity, so an inline
  // `conn={{...}}` object literal does not restart polling every render.
  const { baseUrl, apiKey, fetch: fetchFn } = conn;

  const [fetched, setFetched] = useState<FetchedState | null>(null);

  useEffect(() => {
    if (id === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connection: CanopyConnection = { baseUrl, apiKey, fetch: fetchFn };

    const poll = async () => {
      let job: JobStatusDTO;
      try {
        job = await getJob(connection, id);
      } catch (err) {
        if (cancelled) return;
        setFetched((previous) => ({
          forId: id,
          // Keep the last good snapshot (if it was for this id) next to the error.
          job: previous?.forId === id ? previous.job : null,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
        return;
      }
      if (cancelled) return;
      setFetched({ forId: id, job, error: null });
      if (!isTerminalJobStatus(job.status)) {
        timer = setTimeout(() => {
          void poll();
        }, pollMs);
      }
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [id, pollMs, baseUrl, apiKey, fetchFn]);

  const current = id !== null && fetched?.forId === id ? fetched : null;
  return {
    job: current?.job ?? null,
    error: current?.error ?? null,
    loading: id !== null && current === null,
  };
}
