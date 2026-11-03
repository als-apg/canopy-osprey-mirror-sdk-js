import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanopyError } from '../rest/canopyFetch.js';
import type { CanopyConnection } from '../rest/canopyFetch.js';
import { createFakeFetch, jsonResponse } from '../testing/fakeFetch.js';
import type { FakeRoutes } from '../testing/fakeFetch.js';
import {
  createElogEntry,
  getElogConfig,
  getElogHealthSummary,
  getElogWatchdog,
  isElogError,
  listElogLogbooks,
  listElogRecentEntries,
  listElogTags,
  searchElogUsers,
  uploadElogAttachment,
} from './elog.js';
import type { ElogConfigDTO, ElogEntryCreateDTO, ElogHealthSummaryDTO } from './types.js';

// The package compiles without the DOM lib, so name Node's Blob/File/FormData structurally.
type BlobCtor = new (parts: string[], options?: { type?: string }) => unknown;
type FileCtor = new (parts: string[], name: string, options?: { type?: string }) => unknown;
type FormDataEntryLike = { name: string; type: string; text(): Promise<string> };
type FormDataLike = {
  get(name: string): FormDataEntryLike | null;
  getAll(name: string): unknown[];
};
const { Blob, File } = globalThis as unknown as { Blob: BlobCtor; File: FileCtor };

function makeConn(routes: FakeRoutes) {
  const fetch = createFakeFetch(routes);
  const conn: CanopyConnection = { baseUrl: 'http://canopy', apiKey: 'elog-key', fetch };
  return { conn, fetch };
}

describe('elog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getElogConfig GETs /elog/v1/apps/{app}/config', async () => {
    const config: ElogConfigDTO = {
      enabled: false,
      provider: null,
      defaultLogbookIds: [],
      reason: 'No e-log provider is configured',
    };
    const { conn, fetch } = makeConn({ 'GET /elog/v1/apps/:app/config': jsonResponse(config) });

    await expect(getElogConfig(conn, 'trace')).resolves.toEqual(config);
    expect(fetch.calls[0]).toMatchObject({
      url: 'http://canopy/elog/v1/apps/trace/config',
      headers: { 'X-API-Key': 'elog-key' },
    });
  });

  it('percent-encodes the app name and the logbook id', async () => {
    const { conn, fetch } = makeConn({
      'GET /elog/v1/apps/:app/logbooks': jsonResponse([{ id: 'lb1', name: 'MCC' }]),
      'GET /elog/v1/apps/:app/logbooks/:logbookId/tags': jsonResponse([{ id: 't1', name: 'BPM' }]),
    });

    await expect(listElogLogbooks(conn, 'squirrel')).resolves.toEqual([{ id: 'lb1', name: 'MCC' }]);
    await expect(listElogTags(conn, 'a/b', 'lb 1')).resolves.toEqual([{ id: 't1', name: 'BPM' }]);
    expect(fetch.calls.map((call) => call.url)).toEqual([
      'http://canopy/elog/v1/apps/squirrel/logbooks',
      'http://canopy/elog/v1/apps/a%2Fb/logbooks/lb%201/tags',
    ]);
    expect(fetch.calls[1]!.params).toEqual({ app: 'a/b', logbookId: 'lb 1' });
  });

  it('searchElogUsers sends search and the optional limit', async () => {
    const { conn, fetch } = makeConn({ 'GET /elog/v1/apps/:app/users': jsonResponse([]) });

    await searchElogUsers(conn, 'trace', 'ada lovelace', { limit: 5 });
    await searchElogUsers(conn, 'trace', 'ada');
    expect(fetch.calls.map((call) => call.url)).toEqual([
      'http://canopy/elog/v1/apps/trace/users?search=ada%20lovelace&limit=5',
      'http://canopy/elog/v1/apps/trace/users?search=ada',
    ]);
  });

  it('listElogRecentEntries repeats the logbookId query key', async () => {
    const entries = [{ id: 'e1', title: 'Shift summary', loggedAt: null, loggedBy: 'trace' }];
    const { conn, fetch } = makeConn({
      'GET /elog/v1/apps/:app/recent-entries': jsonResponse(entries),
    });

    await expect(listElogRecentEntries(conn, 'trace', ['a', 'b'], { limit: 3 })).resolves.toEqual(
      entries
    );
    expect(fetch.calls[0]!.url).toBe(
      'http://canopy/elog/v1/apps/trace/recent-entries?logbookId=a&logbookId=b&limit=3'
    );
  });

  it('uploadElogAttachment POSTs one multipart part named file', async () => {
    const { conn, fetch } = makeConn({
      'POST /elog/v1/apps/:app/attachments': jsonResponse({ id: 'att-1' }),
    });

    const blob = new Blob(['x,y\n1,2\n'], { type: 'text/csv' }) as never;
    await expect(
      uploadElogAttachment(conn, 'trace', blob, { filename: 'plot.csv' })
    ).resolves.toEqual({ id: 'att-1' });

    const [call] = fetch.calls;
    expect(call).toMatchObject({
      method: 'POST',
      url: 'http://canopy/elog/v1/apps/trace/attachments',
    });
    // No JSON Content-Type: fetch sets the multipart boundary itself.
    expect(call!.headers).toEqual({ Accept: 'application/json', 'X-API-Key': 'elog-key' });
    const form = call!.body as FormDataLike;
    expect(form.getAll('file')).toHaveLength(1);
    const part = form.get('file')!;
    expect(part.name).toBe('plot.csv');
    expect(part.type).toBe('text/csv');
    await expect(part.text()).resolves.toBe('x,y\n1,2\n');
  });

  it("uploadElogAttachment keeps a File's own name unless filename is given", async () => {
    const { conn, fetch } = makeConn({
      'POST /elog/v1/apps/:app/attachments': jsonResponse({ id: 'att-1' }),
    });

    const file = new File(['png'], 'screenshot.png', { type: 'image/png' }) as never;
    await uploadElogAttachment(conn, 'trace', file);
    await uploadElogAttachment(conn, 'trace', file, { filename: 'renamed.png' });

    const names = fetch.calls.map((call) => (call.body as FormDataLike).get('file')!.name);
    expect(names).toEqual(['screenshot.png', 'renamed.png']);
  });

  it('uploadElogAttachment throws a plain Error without a global FormData', async () => {
    const { conn, fetch } = makeConn({});
    vi.stubGlobal('FormData', undefined);

    await expect(uploadElogAttachment(conn, 'trace', new Blob(['x']) as never)).rejects.toThrow(
      /no FormData implementation/
    );
    expect(fetch.calls).toHaveLength(0);
  });

  it('createElogEntry POSTs the entry as JSON', async () => {
    const { conn, fetch } = makeConn({
      'POST /elog/v1/apps/:app/entries': jsonResponse({ id: 'e9', url: null }),
    });
    const entry: ElogEntryCreateDTO = {
      logbookIds: ['lb1'],
      title: 'Orbit drift',
      bodyMarkdown: '**BPM** readings drifted.',
      tagIds: [],
      attachmentIds: ['att-1'],
      eventAt: '2026-10-20T17:00:00.000Z',
      followsUpEntryId: null,
    };

    await expect(createElogEntry(conn, 'squirrel', entry)).resolves.toEqual({
      id: 'e9',
      url: null,
    });
    expect(fetch.calls[0]).toMatchObject({
      method: 'POST',
      url: 'http://canopy/elog/v1/apps/squirrel/entries',
      json: entry,
    });
    expect(fetch.calls[0]!.headers['Content-Type']).toBe('application/json');
  });

  it('getElogHealthSummary and getElogWatchdog GET the module health routes', async () => {
    const summary: ElogHealthSummaryDTO = {
      status: 'degraded',
      provider: 'elog_plus',
      reason: null,
      apps: [
        {
          app: 'squirrel',
          healthy: true,
          identity: 'squirrel@example.org',
          latencyMs: 12.5,
          lastError: null,
        },
        { app: 'trace', healthy: false, identity: null, latencyMs: null, lastError: 'HTTP 401' },
      ],
    };
    const heartbeat = { module: 'elog', version: '1.0.0', uptimeS: 3.5, nowTsNs: 1.7e18 };
    const { conn, fetch } = makeConn({
      'GET /elog/v1/health/summary': jsonResponse(summary),
      'GET /elog/v1/health/watchdog': jsonResponse(heartbeat),
    });

    await expect(getElogHealthSummary(conn)).resolves.toEqual(summary);
    await expect(getElogWatchdog(conn)).resolves.toEqual(heartbeat);
    expect(fetch.calls.map((call) => call.path)).toEqual([
      '/elog/v1/health/summary',
      '/elog/v1/health/watchdog',
    ]);
  });

  it('surfaces e-log failures as CanopyError with the module code', async () => {
    const { conn } = makeConn({
      'POST /elog/v1/apps/:app/attachments': jsonResponse(
        {
          code: 'elog_attachment_too_large',
          detail: 'Attachment is 30000000 bytes; limit is 20971520 bytes',
        },
        { status: 413 }
      ),
      'GET /elog/v1/apps/:app/logbooks': jsonResponse(
        { code: 'insufficient_module_access', detail: "API key is not scoped to module 'elog'" },
        { status: 403 }
      ),
    });

    const upload = uploadElogAttachment(conn, 'trace', new Blob(['big']) as never);
    await expect(upload).rejects.toMatchObject({ code: 'elog_attachment_too_large', status: 413 });
    const error = await upload.catch((err: unknown) => err);
    expect(isElogError(error)).toBe(true);
    expect(isElogError(error, 'elog_attachment_too_large')).toBe(true);
    expect(isElogError(error, 'elog_upstream_error')).toBe(false);

    const denied = await listElogLogbooks(conn, 'trace').catch((err: unknown) => err);
    expect(denied).toBeInstanceOf(CanopyError);
    expect(isElogError(denied)).toBe(false); // an auth code, not an e-log one
  });

  it('isElogError is false for anything that is not a CanopyError', () => {
    expect(isElogError(new Error('elog_not_configured'))).toBe(false);
    expect(isElogError({ code: 'elog_not_configured' })).toBe(false);
    expect(isElogError(undefined)).toBe(false);
    expect(isElogError(new CanopyError('elog_not_configured', 503, 'disabled'))).toBe(true);
  });
});
