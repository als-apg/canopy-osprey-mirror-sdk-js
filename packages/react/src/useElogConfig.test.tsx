import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CanopyConnection, ElogConfigDTO } from '@slaclab/canopy-client';
import { createFakeFetch, jsonResponse } from '@slaclab/canopy-client/testing';
import { CanopyProvider } from './CanopyProvider.js';
import { useCanopyElogConfig, useElogConfig } from './useElogConfig.js';

const enabled: ElogConfigDTO = {
  enabled: true,
  provider: 'elog_plus',
  defaultLogbookIds: ['lb1'],
  reason: null,
};
const disabled: ElogConfigDTO = {
  enabled: false,
  provider: 'elog_plus',
  defaultLogbookIds: [],
  reason: "No e-log token is configured for app 'squirrel'",
};

afterEach(() => {
  cleanup();
});

describe('useElogConfig', () => {
  it('is idle (not loading, no fetch) when app is null', async () => {
    const fetch = createFakeFetch();
    const { result } = renderHook(() => useElogConfig({ baseUrl: 'http://canopy', fetch }, null));

    expect(result.current).toEqual({ config: null, error: null, loading: false });
    expect(fetch.calls).toHaveLength(0);
  });

  it("fetches the app's config once", async () => {
    const fetch = createFakeFetch({ 'GET /elog/v1/apps/trace/config': jsonResponse(enabled) });
    const { result, rerender } = renderHook(() =>
      // An inline connection literal must not refetch on every render.
      useElogConfig({ baseUrl: 'http://canopy', fetch }, 'trace')
    );

    expect(result.current).toEqual({ config: null, error: null, loading: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ config: enabled, error: null, loading: false });

    rerender();
    expect(fetch.calls).toHaveLength(1);
  });

  it('reports a disabled app as config, not as an error', async () => {
    const fetch = createFakeFetch({ 'GET /elog/v1/apps/:app/config': jsonResponse(disabled) });
    const { result } = renderHook(() =>
      useElogConfig({ baseUrl: 'http://canopy', fetch }, 'squirrel')
    );

    await waitFor(() => expect(result.current.config).toEqual(disabled));
    expect(result.current.error).toBeNull();
  });

  it('surfaces a failed request on error, with no config', async () => {
    const fetch = createFakeFetch({
      'GET /elog/v1/apps/:app/config': jsonResponse(
        { code: 'invalid_app_name', detail: 'Invalid app name' },
        { status: 400 }
      ),
    });
    const { result } = renderHook(() =>
      useElogConfig({ baseUrl: 'http://canopy', fetch }, 'Not Valid')
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toBeNull();
    expect(result.current.error).toMatchObject({ code: 'invalid_app_name', status: 400 });
  });

  it("refetches for a new app and never shows the previous app's config", async () => {
    const fetch = createFakeFetch({
      'GET /elog/v1/apps/trace/config': jsonResponse(enabled),
      'GET /elog/v1/apps/squirrel/config': jsonResponse(disabled),
    });
    const conn: CanopyConnection = { baseUrl: 'http://canopy', fetch };
    const { result, rerender } = renderHook(({ app }) => useElogConfig(conn, app), {
      initialProps: { app: 'trace' },
    });
    await waitFor(() => expect(result.current.config).toEqual(enabled));

    rerender({ app: 'squirrel' });
    expect(result.current).toEqual({ config: null, error: null, loading: true });
    await waitFor(() => expect(result.current.config).toEqual(disabled));
    expect(fetch.calls.map((call) => call.path)).toEqual([
      '/elog/v1/apps/trace/config',
      '/elog/v1/apps/squirrel/config',
    ]);
  });

  it('aborts the request in flight on unmount', async () => {
    let signal: { aborted: boolean } | undefined;
    const fetch = createFakeFetch({
      'GET /elog/v1/apps/:app/config': () => new Promise(() => {}),
    });
    const conn: CanopyConnection = {
      baseUrl: 'http://canopy',
      fetch: (url, init) => {
        signal = (init as { signal?: { aborted: boolean } }).signal;
        return fetch(url, init);
      },
    };
    const { unmount } = renderHook(() => useElogConfig(conn, 'trace'));
    await waitFor(() => expect(signal).toBeDefined());

    unmount();
    expect(signal!.aborted).toBe(true);
  });
});

describe('useCanopyElogConfig', () => {
  it("uses the CanopyProvider's connection", async () => {
    const fetch = createFakeFetch(
      { 'GET /elog/v1/apps/trace/config': jsonResponse(enabled) },
      { baseUrl: '/api/canopy' }
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CanopyProvider connection={{ baseUrl: '/api/canopy', fetch }}>{children}</CanopyProvider>
    );
    const { result } = renderHook(() => useCanopyElogConfig('trace'), { wrapper });

    await waitFor(() => expect(result.current.config).toEqual(enabled));
    expect(fetch.calls[0]!.url).toBe('/api/canopy/elog/v1/apps/trace/config');
  });
});
