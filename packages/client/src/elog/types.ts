// Wire DTOs for Canopy's e-log API (`/elog/v1/...`).
//
// These mirror Canopy's Python contracts (`canopy.elog.schemas.elog`,
// `canopy.elog.schemas.health`), whose pydantic base (`CanopyModel`)
// serializes snake_case field names to camelCase on the wire. Canopy holds
// one e-log application token per client app (the `{app}` path segment), so
// the browser never holds one.

/**
 * Codes the e-log module itself answers with:
 *
 * - `invalid_app_name` (400): `{app}` is not `^[a-z0-9_-]{1,64}$`.
 * - `elog_app_not_found` (404): no e-log token is configured for `{app}`.
 * - `elog_not_configured` (503): no usable e-log provider on this instance.
 * - `elog_upstream_error` (502): the e-log backend rejected the call (an
 *   unknown `additionalAuthors` email, a token without write access to a
 *   logbook, an unknown follow-up parent), was unreachable, or answered
 *   garbage. `detail` includes the backend's own error message when it
 *   sent one; otherwise it names only the status or the transport error.
 * - `elog_upstream_timeout` (504): the e-log backend did not answer in time.
 * - `elog_not_supported` (501): the provider has no equivalent of the call.
 * - `elog_attachment_too_large` (413): the upload is over the instance's
 *   limit (20 MiB by default).
 *
 * The routes can also answer with a {@link CanopyAuthErrorCode} and, for a
 * malformed request, `validation_error` (422).
 */
export type ElogErrorCode =
  | 'invalid_app_name'
  | 'elog_app_not_found'
  | 'elog_not_configured'
  | 'elog_upstream_error'
  | 'elog_upstream_timeout'
  | 'elog_not_supported'
  | 'elog_attachment_too_large';

/**
 * Whether an app can post (`GET /elog/v1/apps/{app}/config`, no API key
 * needed), so its client can show or hide "Post to e-log". Always answered
 * for a well-formed app name: an unknown app, or one without a token, is
 * `enabled: false` with a `reason`.
 */
export interface ElogConfigDTO {
  enabled: boolean;
  /** The active provider's name (e.g. `"elog_plus"`), or null when the module is disabled. */
  provider: string | null;
  /** Logbooks to preselect in a post dialog. */
  defaultLogbookIds: string[];
  /** Why `enabled` is false; null otherwise. */
  reason: string | null;
}

export interface ElogLogbookDTO {
  id: string;
  name: string;
}

export interface ElogTagDTO {
  id: string;
  name: string;
}

/** A person known to the e-log backend: a candidate for `additionalAuthors`. */
export interface ElogUserDTO {
  uid: string;
  commonName: string;
  surname: string;
  gecos: string;
  mail: string;
}

/** An entry this app's token posted, offered as a follow-up parent. */
export interface ElogRecentEntryDTO {
  id: string;
  title: string;
  /**
   * ISO-8601 with a UTC offset (`"2026-10-20T17:00:00Z"`), so
   * `new Date(loggedAt)` is correct; null when the backend sent none.
   */
  loggedAt: string | null;
  loggedBy: string;
}

/** An uploaded attachment; pass `id` in `attachmentIds` when posting. */
export interface ElogAttachmentDTO {
  id: string;
}

/**
 * A new entry (`POST /elog/v1/apps/{app}/entries`), or a follow-up of
 * `followsUpEntryId` when that is set. There is no author field: the e-log
 * records the app's own token identity.
 *
 * Every id in the lists, each `additionalAuthors` email and
 * `followsUpEntryId` must be a non-empty string: Canopy answers 422
 * `validation_error` for `""` (send `null` or leave `followsUpEntryId` out
 * for a fresh entry). Unknown fields are ignored.
 */
export interface ElogEntryCreateDTO {
  /** At least one. */
  logbookIds: string[];
  /** 1 to 255 characters. */
  title: string;
  /**
   * Up to 1,000,000 characters. Rendered to HTML for the e-log, then cleaned
   * to paragraphs, headings, emphasis, code, lists, quotes, tables and
   * `http`/`https`/`mailto` links. Images and raw HTML are dropped: attach
   * images with `uploadElogAttachment`.
   */
  bodyMarkdown: string;
  tagIds?: string[];
  /** Ids from `uploadElogAttachment`. */
  attachmentIds?: string[];
  /**
   * Emails the e-log backend knows (see `searchElogUsers`); one unknown
   * email rejects the whole post (502 `elog_upstream_error`).
   */
  additionalAuthors?: string[];
  /** Default false. */
  important?: boolean;
  /**
   * When the event happened, ISO-8601 with an offset, e.g.
   * `new Date().toISOString()`. Canopy converts it to UTC; a value without
   * an offset is taken as UTC already.
   */
  eventAt?: string | null;
  followsUpEntryId?: string | null;
}

export interface ElogEntryResultDTO {
  id: string;
  /** Link to the posted entry, when the provider gives one (currently always null). */
  url: string | null;
}

/**
 * `disabled`: no usable provider is configured. `down`: a provider is set
 * but no app has a token, or no app's token probe succeeds. `degraded`:
 * some probes fail. `ok`: every probe succeeds.
 */
export type ElogHealthStatus = 'ok' | 'degraded' | 'down' | 'disabled';

/** One app's token, probed with the provider's own identity lookup. */
export interface ElogAppHealthDTO {
  app: string;
  healthy: boolean;
  /** Who the e-log backend says the token is (elog-plus: the app's email). */
  identity: string | null;
  latencyMs: number | null;
  lastError: string | null;
}

/** `GET /elog/v1/health/summary`: a rollup across the configured apps. */
export interface ElogHealthSummaryDTO {
  status: ElogHealthStatus;
  provider: string | null;
  /**
   * Explains `disabled` and the no-token `down`; null otherwise (per-app
   * failures are in `apps[].lastError`).
   */
  reason: string | null;
  apps: ElogAppHealthDTO[];
}
