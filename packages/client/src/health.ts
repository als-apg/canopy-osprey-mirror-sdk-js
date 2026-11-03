// Shared Canopy health contract, mirroring `canopy.contracts.health`.

/**
 * Liveness heartbeat from a module's `GET /<module>/v1/health/watchdog`
 * (no API key needed). It never touches the module's backing store or
 * adapters, so it says the module is up, not that it works; modules with a
 * deeper check also serve `/health/summary`.
 */
export interface HeartbeatDTO {
  /** The module's name, e.g. `"elog"`. */
  module: string;
  /** Canopy's version. */
  version: string;
  /** Seconds since the module started. */
  uptimeS: number;
  /** Server time, epoch nanoseconds (see `nsToDate`). */
  nowTsNs: number;
}
