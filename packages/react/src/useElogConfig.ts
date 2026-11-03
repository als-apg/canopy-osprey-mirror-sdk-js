import { useEffect, useMemo, useState } from 'react';
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
  /** True while the config for the current app and connection is still in flight. */
  loading: boolean;
}

interface ConfigRequest {
  app: string;
  connection: CanopyConnection;
}

/**
 * The last settled fetch and the request it answered, so a stale app or
 * connection never leaks through.
 */
interface FetchedState {
  request: ConfigRequest;
  config: ElogConfigDTO | null;
  error: Error | null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Fetch Canopy's e-log config for `app` (`GET /elog/v1/apps/{app}/config`)
 * once per app and connection, e.g. to show "Post to e-log" only when
 * `config?.enabled`.
 * The route needs no API key, and an app without an e-log token (or an
 * instance without e-log) is `enabled: false` with a `reason`, not an
 * error. The request is aborted on unmount and when the app or connection
 * changes; a failure is surfaced on `error` and not retried (remount, or
 * change the app, to try again). Pass `app: null` to render without one
 * (returns the idle state).
 */
export function useElogConfig(conn: CanopyConnection, app: string | null): UseElogConfigResult {
  // Depend on the connection's fields, not its identity, so an inline
  // `conn={{...}}` object literal does not refetch every render.
  const { baseUrl, apiKey, fetch: fetchFn } = conn;
  const request = useMemo<ConfigRequest | null>(
    () => (app === null ? null : { app, connection: { baseUrl, apiKey, fetch: fetchFn } }),
    [app, baseUrl, apiKey, fetchFn]
  );

  const [fetched, setFetched] = useState<FetchedState | null>(null);

  useEffect(() => {
    if (request === null) return;

    let cancelled = false;
    const controller = new AbortController();
    getElogConfig(request.connection, request.app, controller.signal).then(
      (config) => {
        if (!cancelled) setFetched({ request, config, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setFetched({ request, config: null, error: toError(err) });
      }
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [request]);

  const current = request !== null && fetched?.request === request ? fetched : null;
  return {
    config: current?.config ?? null,
    error: current?.error ?? null,
    loading: request !== null && current === null,
  };
}

/**
 * {@link useElogConfig} against the connection from the nearest `CanopyProvider`.
 */
export function useCanopyElogConfig(app: string | null): UseElogConfigResult {
  return useElogConfig(useCanopyConnection(), app);
}
