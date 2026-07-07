// ── Alarm ────────────────────────────────────────────────────────────────

export const AlarmSeverity = {
  NO_ALARM: 0,
  MINOR: 1,
  MAJOR: 2,
  INVALID: 3,
  DISCONNECTED: 4,
} as const;
export type AlarmSeverity = (typeof AlarmSeverity)[keyof typeof AlarmSeverity];

export const AlarmSeverityName: Record<AlarmSeverity, string> = Object.fromEntries(
  Object.entries(AlarmSeverity).map(([name, value]) => [value, name])
) as Record<AlarmSeverity, string>;
