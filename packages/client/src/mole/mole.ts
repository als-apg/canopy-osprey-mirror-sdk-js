// Client for Canopy Mole's history REST API (`/mole/v1/...`). Every call
// takes an explicit `CanopyConnection` (base URL + API key). Paths and query
// aliases follow `canopy.mole.api.v1`.

import { canopyFetch } from '../rest/canopyFetch.js';
import type { AbortSignalLike, CanopyConnection } from '../rest/canopyFetch.js';
import type {
  ArchiverDataDTO,
  ArchiverListDTO,
  BinningMode,
  PVMetadataDTO,
  SearchResultsDTO,
} from './types.js';

export interface FetchDataParams {
  /** Window start, epoch ns (required by the API). */
  fromNs: number;
  /** Window end, epoch ns. Omit for "now". */
  toNs?: number;
  /** Archiver instance name; the server default when omitted. */
  archiver?: string;
  /** Switches the response to binned mode (`ArchiverBinnedSeriesDTO`). */
  binning?: BinningMode;
  /** Decimation cap (raw) or target bucket count (`binning: 'auto'`). */
  maxPoints?: number;
  /** Bucket width in ns; required by the API when `binning: 'time'`. */
  binSizeNs?: number;
  /**
   * Raw mode only: also return the most recent sample before `fromNs`, at
   * its true (pre-window) timestamp, so sparse on-change PVs have a defined
   * value at the window's left edge.
   */
  includeLastBefore?: boolean;
}

/** Fetch one PV's time-window data. Branch on the result's `mode`. */
export async function fetchData(
  conn: CanopyConnection,
  pv: string,
  params: FetchDataParams,
  signal?: AbortSignalLike
): Promise<ArchiverDataDTO> {
  return canopyFetch<ArchiverDataDTO>(conn, `/mole/v1/data/${encodeURIComponent(pv)}`, {
    query: {
      from: params.fromNs,
      to: params.toNs,
      archiver: params.archiver,
      binning: params.binning,
      maxPoints: params.maxPoints,
      binSize: params.binSizeNs,
      includeLastBefore: params.includeLastBefore,
    },
    signal,
  });
}

/** Per-PV metadata as the archiver knows it. */
export async function fetchMetadata(
  conn: CanopyConnection,
  pv: string,
  archiver?: string,
  signal?: AbortSignalLike
): Promise<PVMetadataDTO> {
  return canopyFetch<PVMetadataDTO>(conn, `/mole/v1/metadata/${encodeURIComponent(pv)}`, {
    query: { archiver },
    signal,
  });
}

/** Search one archiver's PV index by name pattern (Appliance uses regex). */
export async function searchPVs(
  conn: CanopyConnection,
  pattern: string,
  options: { archiver?: string; limit?: number } = {},
  signal?: AbortSignalLike
): Promise<SearchResultsDTO> {
  return canopyFetch<SearchResultsDTO>(conn, '/mole/v1/search', {
    query: { pattern, archiver: options.archiver, limit: options.limit },
    signal,
  });
}

/** List all configured archivers with current health. */
export async function listArchivers(
  conn: CanopyConnection,
  signal?: AbortSignalLike
): Promise<ArchiverListDTO> {
  return canopyFetch<ArchiverListDTO>(conn, '/mole/v1/archivers', { signal });
}
