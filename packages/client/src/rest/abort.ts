import type { AbortSignalLike } from './canopyFetch.js';

/**
 * What an aborted operation rejects with: the signal's `reason`, or a
 * synthetic `AbortError` when none was given (as real fetch does).
 */
export function abortReason(signal: AbortSignalLike): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}
