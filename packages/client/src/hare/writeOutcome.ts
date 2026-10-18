// The WC6 write-outcome table: how a PUT /hare/v1/pvs/{pv} (or its absence)
// becomes a `WriteOutcome`. Canopy's `canopy/contracts/wc6_vectors.json` is
// the one definition; this table mirrors its `outcome`, `status`, `code` and
// `default` per row, and a vitest checks it against a byte copy of that file
// (packages/client/test-vectors/wc6_vectors.json). Edit both together.

import type { WriteOutcome, WriteOutcomeKind } from './types.js';

/** One WC6 row as the client needs it: `detail` is the row's default (toast-ready) text. */
export interface Wc6Row {
  outcome: WriteOutcomeKind | null;
  status: number | null;
  code: string | null;
  detail: string | null;
}

/**
 * Longest envelope detail a server row carries, in Unicode code points with the
 * cut's ellipsis included; longer text is cut here too, on a word boundary.
 */
export const WC6_DETAIL_MAX_CHARS = 512;

const DETAIL_ELLIPSIS = '\u2026';

/**
 * `text` when it fits in `limit` code points; otherwise the longest whole-word
 * prefix (trailing whitespace dropped) followed by an ellipsis, at most `limit`
 * code points long. A first word longer than the limit is cut inside the word.
 */
export function cutWc6Detail(text: string, limit: number = WC6_DETAIL_MAX_CHARS): string {
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  const headChars = chars.slice(0, limit - 1);
  let head = headChars.join('');
  if (!/\s/.test(chars[headChars.length]!)) {
    // Python's head.rsplit(None, 1)[0]: all before the last whitespace run that
    // separates two words, trailing whitespace ignored.
    const words = /^([\s\S]*\S)\s+\S+\s*$/.exec(head);
    if (words) head = words[1]!;
  }
  return head.trimEnd() + DETAIL_ELLIPSIS;
}

const REFUSED_GENERIC = 'the write was refused; nothing written';
const TARGET_CHANGED = 'the control target changed; nothing written';
const TARGET_OR_WRITES_CHANGED = 'the control target or its write state changed; nothing written';
const WRITES_CHANGED = 'the write state of this target changed; nothing written';
const UNKNOWN = 'outcome unknown — check the readback';
const FRONT_REFUSED = 'the panel server refused this write; nothing written';

/** Every WC6 row by id, mirroring the vector file. */
export const WC6_ROWS: Readonly<Record<string, Wc6Row>> = {
  '1-off-disabled': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'writes from screens are not enabled in this deployment; nothing written',
  },
  '1-off-origin': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'screens stay read-only until agent pages have their own origin; nothing written',
  },
  '2': {
    outcome: 'target_changed',
    status: 409,
    code: 'pv_target_changed',
    detail: TARGET_CHANGED,
  },
  '3': {
    outcome: 'target_changed',
    status: 409,
    code: 'pv_target_changed',
    detail: TARGET_CHANGED,
  },
  '3a': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: WRITES_CHANGED,
  },
  '4': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'no control target record; nothing written',
  },
  '4b': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'this control target cannot be served here; nothing written',
  },
  '5': {
    outcome: 'switch_in_progress',
    status: 409,
    code: 'pv_switch_in_progress',
    detail: 'a target switch is in progress; nothing written',
  },
  '5a': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'the audit ledger is unavailable; nothing written',
  },
  '5b': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'a write to this channel is still in progress; nothing written',
  },
  '5c': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'the switch state could not be checked; nothing written',
  },
  '6': { outcome: 'refused', status: 403, code: 'pv_write_refused', detail: REFUSED_GENERIC },
  '6-readonly-run': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'the whole deployment is running read-only; nothing written',
  },
  '7': { outcome: 'refused', status: 403, code: 'pv_write_refused', detail: REFUSED_GENERIC },
  '8': { outcome: 'refused', status: 403, code: 'pv_write_refused', detail: REFUSED_GENERIC },
  '9': { outcome: 'refused', status: 403, code: 'pv_write_refused', detail: REFUSED_GENERIC },
  '10': { outcome: 'confirmed', status: 200, code: null, detail: 'written' },
  '11': {
    outcome: 'mismatch',
    status: 409,
    code: 'pv_write_mismatch',
    detail: 'written; the channel holds a different value',
  },
  '12': {
    outcome: 'unconfirmed',
    status: 502,
    code: 'pv_write_unconfirmed',
    detail: 'sent, not verified',
  },
  '13': { outcome: 'unknown', status: 502, code: 'pv_write_unknown', detail: UNKNOWN },
  '14': { outcome: 'unknown', status: 502, code: 'pv_write_unknown', detail: UNKNOWN },
  '14a': {
    outcome: 'refused',
    status: 405,
    code: null,
    detail: 'writes are not enabled on this server',
  },
  '14b-401': {
    outcome: 'refused',
    status: 401,
    code: 'invalid_access_credential',
    detail: FRONT_REFUSED,
  },
  '14b-403': { outcome: 'refused', status: 403, code: 'pv_write_refused', detail: FRONT_REFUSED },
  '14b-404': { outcome: 'refused', status: 404, code: 'pv_write_refused', detail: FRONT_REFUSED },
  '14b-413': { outcome: 'refused', status: 413, code: 'pv_write_refused', detail: FRONT_REFUSED },
  '15': { outcome: 'unknown', status: null, code: null, detail: UNKNOWN },
  '16': { outcome: 'target_changed', status: null, code: null, detail: TARGET_OR_WRITES_CHANGED },
  '16a': { outcome: 'target_changed', status: null, code: null, detail: WRITES_CHANGED },
  '16-coalesced': { outcome: null, status: null, code: null, detail: null },
};

/**
 * The viewer's toast for a run stopped by a coalesced write (row
 * 16-coalesced). A coalesced outcome itself is never toasted.
 */
export const WC6_COALESCED_TOAST = 'a newer value replaced this one; nothing more sent';

/**
 * How each recognised envelope code maps: the row whose outcome it takes and
 * whose default detail stands in for a missing one, and whether the server's
 * own detail is the toast. Server rows (`pv_*`) carry toast text as their
 * detail; FRONT's access gate (`invalid_access_credential`) does not, so its
 * row text is used. Any other code is row 15.
 */
const CODE_ROWS: Readonly<Record<string, { row: string; serverDetail: boolean }>> = {
  pv_write_refused: { row: '6', serverDetail: true },
  pv_target_changed: { row: '2', serverDetail: true },
  pv_switch_in_progress: { row: '5', serverDetail: true },
  pv_write_mismatch: { row: '11', serverDetail: true },
  pv_write_unconfirmed: { row: '12', serverDetail: true },
  pv_write_unknown: { row: '13', serverDetail: true },
  invalid_access_credential: { row: '14b-401', serverDetail: false },
};

/** The code → row map, exposed for the table test. */
export const WC6_CODE_ROWS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CODE_ROWS).map(([code, { row }]) => [code, row])
);

function rowOutcome(
  rowId: string,
  status: number | null,
  code: string | null,
  detail?: string
): WriteOutcome {
  const row = WC6_ROWS[rowId]!;
  return {
    outcome: row.outcome!,
    code,
    status,
    detail: detail ?? row.detail!,
    coalesced: false,
  };
}

/** Row 16a's text with its one token, `<label>`; a null label takes the row's default. */
const WRITES_CHANGED_TEMPLATE = 'the write state of <label> changed; nothing written';

/**
 * A client-side row that sent no request or got no reply: '15' (unknown),
 * '16' (the target or its write state changed) or '16a' (the write state of
 * the target named by `label` changed). Only '16a' reads `label`; a null or
 * absent label gives the row's default text.
 */
export function clientOutcome(rowId: '15' | '16' | '16a', label?: string | null): WriteOutcome {
  if (rowId === '16a' && label != null) {
    return rowOutcome(
      rowId,
      null,
      null,
      WRITES_CHANGED_TEMPLATE.replace('<label>', () => label)
    );
  }
  return rowOutcome(rowId, null, null);
}

/** Trimmed server detail cut to the cap, or undefined when it is not usable text. */
function toastText(detail: unknown): string | undefined {
  if (typeof detail !== 'string') return undefined;
  const text = detail.trim();
  if (text === '') return undefined;
  return cutWc6Detail(text);
}

/** The parsed body when it is a JSON object (not an array, not null), else null. */
function jsonObject(bodyText: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON.
  }
  return null;
}

/**
 * Map a PUT response to its WC6 outcome. A redirect (`type` is
 * `'opaqueredirect'` under `redirect: 'manual'`, or any 3xx status) is row 15:
 * the write did not reach the relay, or nobody can say whether it did. A 2xx
 * is row 10 only when its body is the server's write result, a JSON object
 * with a string `pv` (shape only: the name is not compared); any other 2xx
 * body — a followed redirect's login page, an empty body — is row 15. Other
 * statuses map by envelope code, and a 405 with none is row 14a (generic
 * canopy with the relay off). An unrecognised code, or a non-2xx with no
 * envelope, is row 15.
 */
export function outcomeFromResponse(
  ok: boolean,
  status: number,
  bodyText: string,
  type?: string
): WriteOutcome {
  if (type === 'opaqueredirect') return rowOutcome('15', null, null);
  if (status >= 300 && status < 400) return rowOutcome('15', status, null);
  if (ok) {
    const result = jsonObject(bodyText);
    return typeof result?.pv === 'string'
      ? rowOutcome('10', status, null)
      : rowOutcome('15', status, null);
  }
  if (status === 405) return rowOutcome('14a', status, null);

  const envelope = jsonObject(bodyText);
  const code = typeof envelope?.code === 'string' ? envelope.code : null;
  const mapping = code !== null && Object.hasOwn(CODE_ROWS, code) ? CODE_ROWS[code] : undefined;
  if (!mapping) return rowOutcome('15', status, code);
  const detail = mapping.serverDetail ? toastText(envelope?.detail) : undefined;
  return rowOutcome(mapping.row, status, code, detail);
}
