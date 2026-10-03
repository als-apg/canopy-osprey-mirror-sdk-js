import type { PVService, PVData, PVListener } from './PVService.js';
import { AlarmSeverity } from '../alarm.js';

// ── loc:// URL grammar ──────────────────────────────────────────────────────
//
// The converter rewrites EDM `LOC\name=<t>:<value>` locals to PyDM-style
// URLs: `loc://<name>?type=<int|float|str|array>&init=<value>`. The first
// (declaring) appearance carries the query; later references may use the bare
// `loc://<name>` short form. Names are opaque strings — EDM scope prefixes
// (e.g. `${!W}` for window scope) ride along verbatim, which preserves EDM's
// sharing semantics within one rendered page.

interface ParsedLocUrl {
  name: string;
  type?: string;
  init?: string;
}

export function parseLocUrl(address: string): ParsedLocUrl | null {
  if (!address.startsWith('loc://')) return null;
  const rest = address.slice('loc://'.length);
  const queryAt = rest.indexOf('?');
  if (queryAt === -1) return { name: rest };
  const name = rest.slice(0, queryAt);
  const out: ParsedLocUrl = { name };
  for (const pair of rest.slice(queryAt + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key === 'type') out.type = value;
    else if (key === 'init') out.init = value;
  }
  return out;
}

function coerceInit(type: string | undefined, raw: string): number | string {
  if (type === 'str') return raw;
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

interface LocalPV {
  data: PVData;
  initialized: boolean;
  listeners: Set<PVListener>;
}

/**
 * Client-side local PVs (the EDM `LOC\` paradigm): screen-scoped scratch
 * variables that widgets write and rules read, never touching a gateway.
 *
 * - A declaring URL (`?type=…&init=…`) initializes the PV on first sight;
 *   later declarations are ignored (first-wins, PyDM semantics). Short-form
 *   references before any declaration read as disconnected until one arrives
 *   or something puts a value.
 * - Scope is the service instance. The composition root owns one per page
 *   and calls `clear()` when the screen changes, mirroring EDM's
 *   window-local lifetime.
 */
export class LocalPVService implements PVService {
  private pvs = new Map<string, LocalPV>();
  private _connected = false;

  get isConnected() {
    return this._connected;
  }

  connect() {
    this._connected = true;
  }

  disconnect() {
    this._connected = false;
  }

  /** Drop every local (screen change); active listeners see disconnected. */
  clear() {
    for (const pv of this.pvs.values()) {
      pv.data = { ...pv.data, connected: false };
      pv.initialized = false;
      for (const listener of pv.listeners) listener(pv.data);
    }
    // Keep entries with live listeners so re-declarations reattach; drop idle ones.
    for (const [name, pv] of this.pvs) {
      if (pv.listeners.size === 0) this.pvs.delete(name);
    }
  }

  private entry(address: string): LocalPV {
    const parsed = parseLocUrl(address) ?? { name: address };
    let pv = this.pvs.get(parsed.name);
    if (!pv) {
      pv = {
        initialized: false,
        listeners: new Set(),
        data: {
          value: 0,
          displayValue: '---',
          severity: AlarmSeverity.NO_ALARM,
          connected: false,
          timestamp: Date.now(),
          units: '',
          precision: 0,
          lowerLimit: 0,
          upperLimit: 0,
        },
      };
      this.pvs.set(parsed.name, pv);
    }
    if (!pv.initialized && parsed.init !== undefined) {
      const value = coerceInit(parsed.type, parsed.init);
      pv.initialized = true;
      pv.data = {
        ...pv.data,
        value,
        displayValue: String(value),
        valueKind: typeof value === 'number' ? 'scalar' : 'string',
        connected: true,
        timestamp: Date.now(),
      };
      for (const listener of pv.listeners) listener(pv.data);
    }
    return pv;
  }

  subscribe(pvName: string, listener: PVListener): () => void {
    const pv = this.entry(pvName);
    pv.listeners.add(listener);
    listener(pv.data);
    return () => {
      pv.listeners.delete(listener);
    };
  }

  put(pvName: string, value: number | string | boolean) {
    const pv = this.entry(pvName);
    const stored = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    pv.initialized = true;
    pv.data = {
      ...pv.data,
      value: stored,
      displayValue: String(stored),
      valueKind: typeof stored === 'number' ? 'scalar' : 'string',
      connected: true,
      timestamp: Date.now(),
    };
    for (const listener of pv.listeners) listener(pv.data);
  }

  getSnapshot(pvName: string): PVData | undefined {
    const parsed = parseLocUrl(pvName) ?? { name: pvName };
    return this.pvs.get(parsed.name)?.data;
  }
}
