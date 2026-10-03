import type { AlarmSeverity } from '../alarm.js';
import type { TableValue, ValueKind } from '../hare/types.js';

// ── PV Data Types ───────────────────────────────────────────────────────────

export interface PVData {
  // Waveform PVs arrive as arrays (number[] / string[]); NTTable PVs arrive as
  // a TableValue.
  value: number | string | boolean | number[] | string[] | TableValue;
  displayValue: string;
  severity: AlarmSeverity;
  connected: boolean;
  timestamp: number;
  units: string;
  precision: number;
  lowerLimit: number;
  upperLimit: number;
  /** Enum state labels (mbbo/bo choices) when the PV is enum-kind; undefined otherwise. */
  enumChoices?: string[];
  /**
   * The value's kind as last reported by the source (a Hare diff/initial, or
   * the type a local/mock service stored). Absent when no value has arrived:
   * `DISCONNECTED_PV` and disconnected copies of it never carry one, so a
   * missing kind is "unknown", never an implied `'scalar'`.
   */
  valueKind?: ValueKind;
}

export type PVListener = (data: PVData) => void;

// ── PV Service Interface ────────────────────────────────────────────────────

export interface PVService {
  subscribe(pvName: string, listener: PVListener): () => void;
  put(pvName: string, value: number | string | boolean): void;
  getSnapshot(pvName: string): PVData | undefined;
  connect(): void;
  disconnect(): void;
  readonly isConnected: boolean;
}

export const DISCONNECTED_PV: PVData = {
  value: 0,
  displayValue: '---',
  severity: 4, // DISCONNECTED
  connected: false,
  timestamp: 0,
  units: '',
  precision: 0,
  lowerLimit: 0,
  upperLimit: 0,
};
