// Client for Canopy's e-log API (`/elog/v1/...`). Every call takes an
// explicit `CanopyConnection` (base URL + API key) and, for the per-app
// routes, the client app's name (`{app}`, e.g. `'trace'`), which picks the
// e-log token Canopy posts with. The API key needs the `elog` module scope,
// plus `read` for lookups and `write` for uploads and posts. Paths and query
// aliases follow `canopy.elog.api.v1`.

import { CanopyError, canopyFetch } from '../rest/canopyFetch.js';
import type { AbortSignalLike, CanopyConnection } from '../rest/canopyFetch.js';
import type { HeartbeatDTO } from '../health.js';
import type { HostBlob } from '../transport.js';
import type {
  ElogAttachmentDTO,
  ElogConfigDTO,
  ElogEntryCreateDTO,
  ElogEntryResultDTO,
  ElogErrorCode,
  ElogHealthSummaryDTO,
  ElogLogbookDTO,
  ElogRecentEntryDTO,
  ElogTagDTO,
  ElogUserDTO,
} from './types.js';

const ELOG_ERROR_CODES: ReadonlySet<string> = new Set<ElogErrorCode>([
  'invalid_app_name',
  'elog_app_not_found',
  'elog_not_configured',
  'elog_upstream_error',
  'elog_upstream_timeout',
  'elog_not_supported',
  'elog_attachment_too_large',
]);

/**
 * True for a {@link CanopyError} the e-log module raised: with `code`, that
 * one code; without, any {@link ElogErrorCode}. Auth failures
 * (`CanopyAuthErrorCode`) and 422 `validation_error` are not e-log codes.
 */
export function isElogError(error: unknown, code?: ElogErrorCode): error is CanopyError {
  if (!(error instanceof CanopyError)) return false;
  return code === undefined ? ELOG_ERROR_CODES.has(error.code) : error.code === code;
}

function appPath(app: string, rest: string): string {
  return `/elog/v1/apps/${encodeURIComponent(app)}${rest}`;
}

/**
 * Whether `app` can post, and its preselected logbooks. Needs no API key;
 * an app without a token, or a disabled module, is `enabled: false` with a
 * `reason` (only a malformed name is an error, 400 `invalid_app_name`).
 */
export async function getElogConfig(
  conn: CanopyConnection,
  app: string,
  signal?: AbortSignalLike
): Promise<ElogConfigDTO> {
  return canopyFetch<ElogConfigDTO>(conn, appPath(app, '/config'), { signal });
}

/** Logbooks the app's token can see. */
export async function listElogLogbooks(
  conn: CanopyConnection,
  app: string,
  signal?: AbortSignalLike
): Promise<ElogLogbookDTO[]> {
  return canopyFetch<ElogLogbookDTO[]>(conn, appPath(app, '/logbooks'), { signal });
}

/** Tags defined on one logbook. */
export async function listElogTags(
  conn: CanopyConnection,
  app: string,
  logbookId: string,
  signal?: AbortSignalLike
): Promise<ElogTagDTO[]> {
  return canopyFetch<ElogTagDTO[]>(
    conn,
    appPath(app, `/logbooks/${encodeURIComponent(logbookId)}/tags`),
    { signal }
  );
}

/**
 * People the e-log knows, by name or email: candidates for
 * `additionalAuthors`. The server takes a `search` of 1 to 100 characters
 * and a `limit` of 1 to 100 (default 20), and answers 422 otherwise.
 */
export async function searchElogUsers(
  conn: CanopyConnection,
  app: string,
  search: string,
  options: { limit?: number } = {},
  signal?: AbortSignalLike
): Promise<ElogUserDTO[]> {
  return canopyFetch<ElogUserDTO[]>(conn, appPath(app, '/users'), {
    query: { search, limit: options.limit },
    signal,
  });
}

/**
 * Entries this app's token posted to any of `logbookIds`, newest first:
 * candidates for `followsUpEntryId`. Sent as a repeated `logbookId` query
 * key. The server needs at least one logbook and a `limit` of 1 to 20
 * (default 5), and answers 422 otherwise.
 */
export async function listElogRecentEntries(
  conn: CanopyConnection,
  app: string,
  logbookIds: readonly string[],
  options: { limit?: number } = {},
  signal?: AbortSignalLike
): Promise<ElogRecentEntryDTO[]> {
  return canopyFetch<ElogRecentEntryDTO[]>(conn, appPath(app, '/recent-entries'), {
    query: { logbookId: logbookIds, limit: options.limit },
    signal,
  });
}

export interface UploadElogAttachmentOptions {
  /**
   * File name sent with the part. Default: a `File`'s own name (a bare
   * `Blob` goes up as `"blob"`).
   */
  filename?: string;
  signal?: AbortSignalLike;
}

interface FormDataAppender {
  append(name: string, value: unknown, filename?: string): void;
}

/**
 * Upload one file (multipart, one part named `file`); pass the returned
 * `id` in `attachmentIds` when posting the entry. Over the instance's limit
 * (20 MiB by default) Canopy answers 413 `elog_attachment_too_large`, though
 * a reverse proxy in front of it may refuse a large body first.
 *
 * Needs a global `FormData` (browsers, Node 18+).
 */
export async function uploadElogAttachment(
  conn: CanopyConnection,
  app: string,
  file: HostBlob,
  options: UploadElogAttachmentOptions = {}
): Promise<ElogAttachmentDTO> {
  const FormDataCtor = (globalThis as { FormData?: new () => FormDataAppender }).FormData;
  if (typeof FormDataCtor !== 'function') {
    throw new Error(
      'uploadElogAttachment: no FormData implementation available (run in a browser or Node 18+).'
    );
  }
  const form = new FormDataCtor();
  if (options.filename === undefined) {
    form.append('file', file);
  } else {
    form.append('file', file, options.filename);
  }
  return canopyFetch<ElogAttachmentDTO>(conn, appPath(app, '/attachments'), {
    method: 'POST',
    body: form,
    signal: options.signal,
  });
}

/** Post an entry as `app` (or a follow-up of `entry.followsUpEntryId`). */
export async function createElogEntry(
  conn: CanopyConnection,
  app: string,
  entry: ElogEntryCreateDTO,
  signal?: AbortSignalLike
): Promise<ElogEntryResultDTO> {
  return canopyFetch<ElogEntryResultDTO>(conn, appPath(app, '/entries'), {
    method: 'POST',
    body: entry,
    signal,
  });
}

/**
 * Per-app token probe across every configured app (`status`, plus why it is
 * `disabled`/`down`, and each app's identity, latency and last error).
 */
export async function getElogHealthSummary(
  conn: CanopyConnection,
  signal?: AbortSignalLike
): Promise<ElogHealthSummaryDTO> {
  return canopyFetch<ElogHealthSummaryDTO>(conn, '/elog/v1/health/summary', { signal });
}

/** The e-log module's liveness heartbeat (no API key needed). */
export async function getElogWatchdog(
  conn: CanopyConnection,
  signal?: AbortSignalLike
): Promise<HeartbeatDTO> {
  return canopyFetch<HeartbeatDTO>(conn, '/elog/v1/health/watchdog', { signal });
}
