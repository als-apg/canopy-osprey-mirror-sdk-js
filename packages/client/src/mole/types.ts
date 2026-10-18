// Wire DTOs for Canopy Mole's history REST API (`/mole/v1/...`).
//
// These mirror Canopy's Python contracts (`canopy.mole.schemas`), whose
// pydantic base (`CanopyModel`) serializes snake_case field names to
// camelCase on the wire (`from_ns`/`to_ns` are explicitly aliased to
// `from`/`to`).

import type { WireAlarmSeverity } from '../wire.js';

export type BinningMode = 'auto' | 'time';

/** One stored sample. `source` is always `"archive"` from Mole. */
export interface SampleDTO {
  tsNs: number;
  value: number | string | boolean | null;
  severity: WireAlarmSeverity;
  source: 'archive';
}

/**
 * Raw-mode response for `GET /mole/v1/data/{pv}`. `from`/`to` carry the
 * resolved window in epoch nanoseconds (handy when the request used
 * `to=now`). With `includeLastBefore`, the first sample may precede `from`
 * at its true timestamp — clip on render.
 */
export interface ArchiverSeriesDTO {
  mode: 'raw';
  pv: string;
  archiver: string;
  from: number;
  to: number;
  decimated: boolean;
  samples: SampleDTO[];
}

/** Statistical bucket from a server-side binning operator. */
export interface BinnedPointDTO {
  tsNs: number;
  binNs: number;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  count: number;
  severity: WireAlarmSeverity;
}

/**
 * Binned-mode response for `GET /mole/v1/data/{pv}` when `binning` is set.
 * `binSizeNs` is `null` in `auto` mode (each point's `binNs` carries the
 * actual bucket width) and echoes the requested width in `time` mode.
 */
export interface ArchiverBinnedSeriesDTO {
  mode: 'binned';
  pv: string;
  archiver: string;
  from: number;
  to: number;
  binning: BinningMode;
  binSizeNs: number | null;
  targetBuckets: number | null;
  points: BinnedPointDTO[];
}

/** Discriminate on `mode`. */
export type ArchiverDataDTO = ArchiverSeriesDTO | ArchiverBinnedSeriesDTO;

/**
 * Per-PV metadata as one archiver knows it. The Appliance adapter populates
 * only `units` and `precision`; the rest stay `null` and come from Channel
 * Access (Hare / EPICS Connector).
 */
export interface PVMetadataDTO {
  pv: string;
  archiver: string;
  description: string | null;
  units: string | null;
  precision: number | null;
  displayLow: number | null;
  displayHigh: number | null;
  alarmLow: number | null;
  alarmHigh: number | null;
  warningLow: number | null;
  warningHigh: number | null;
}

/** One configured archiver instance with current health. */
export interface ArchiverInfoDTO {
  name: string;
  typeName: string;
  url: string;
  healthy: boolean;
  latencyMs: number | null;
  lastError: string | null;
}

export interface ArchiverListDTO {
  default: string;
  archivers: ArchiverInfoDTO[];
}

export interface SearchResultsDTO {
  archiver: string;
  pattern: string;
  pvs: string[];
}
