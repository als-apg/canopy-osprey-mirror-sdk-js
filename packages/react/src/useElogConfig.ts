import { useEffect, useState } from 'react';
import { getElogConfig } from '@slaclab/canopy-client';
import type { CanopyConnection, ElogConfigDTO } from '@slaclab/canopy-client';
import { useCanopyConnection } from './canopyContext.js';

export interface UseElogConfigResult {
  /**
   * The app's e-log config (`enabled`, `defaultLogbookIds`, why it is
   * disabled); null without an app, until it arrives, and after a failure.
   */
  config: ElogConfigDTO | null;
  /** Why the config could not be fetched (usually a `CanopyError`); null otherwise. */
  error: Error | null;
  /** True while the config for the current app is still in flight. */
  loading: boolean;
}

/** What the last settled fetch was for, so a stale app never leaks through. */
interface FetchedState {
  forApp: string;
  config: ElogConfigDTO | null;
  error: Error | null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Fetch Canopy's e-log config for `app` (`GET /elog/v1/apps/{app}/config`)
 * once per app, e.g. to show "Post to e-log" only when `config?.enabled`.
 * The route needs no API key, and an app without an e-log token (or an
 * instance without e-log) is `enabled: false` with a `reason`, not an
 * error. The request is aborted on unmount and app change; a failure is
 * surfaced on `error` and not retried (remount, or change the app, to try
 * again). Pass `app: null` to render without one (returns the idle state).
 */
export function useElogConfig(conn: CanopyConnection, app: string | null): UseElogConfigResult {
  // Depend on the connection's fields, not its identity, so an inline
  // `conn={{...}}` object literal does not refetch every render.
  const { baseUrl, apiKey, fetch: fetchFn } = conn;

  const [fetched, setFetched] = useState<FetchedState | null>(null);

  useEffect(() => {
    if (app === null) return;

    let cancelled = false;
    const controller = new AbortController();
    const connection: CanopyConnection = { baseUrl, apiKey, fetch: fetchFn };
    getElogConfig(connection, app, controller.signal).then(
      (config) => {
        if (!cancelled) setFetched({ forApp: app, config, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setFetched({ forApp: app, config: null, error: toError(err) });
      }
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [app, baseUrl, apiKey, fetchFn]);

  const current = app !== null && fetched?.forApp === app ? fetched : null;
  return {
    config: current?.config ?? null,
    error: current?.error ?? null,
    loading: app !== null && current === null,
  };
}

/**
 * {@link useElogConfig} against the connection from the nearest `CanopyProvider`.
 */
export function useCanopyElogConfig(app: string | null): UseElogConfigResult {
  return useElogConfig(useCanopyConnection(), app);
}
