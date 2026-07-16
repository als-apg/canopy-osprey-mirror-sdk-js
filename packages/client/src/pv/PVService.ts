import type { AlarmSeverity } from '../alarm.js';
import type { TableValue } from '../hare/types.js';

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
