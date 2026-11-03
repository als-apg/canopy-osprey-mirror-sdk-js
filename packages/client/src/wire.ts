// Shared Canopy wire primitives, mirroring `canopy.contracts.sample`.
// Module-specific DTOs (Formula Engine, Mole) build on these; Hare predates
// this file and keeps its own `HareAlarmSeverity` alias of the same union for
// backwards compatibility.

/** Alarm severity as carried on the wire (a string enum on the Python side). */
export type WireAlarmSeverity = 'NO_ALARM' | 'MINOR' | 'MAJOR' | 'INVALID';
