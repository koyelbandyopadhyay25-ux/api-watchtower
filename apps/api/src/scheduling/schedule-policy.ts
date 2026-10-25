export const MONITORING_INTERVALS = [5, 15, 30, 60] as const;
export type MonitoringInterval = typeof MONITORING_INTERVALS[number];

export function isMonitoringInterval(value: unknown): value is MonitoringInterval {
  return MONITORING_INTERVALS.some(interval => interval === value);
}

export function isDue(enabled: boolean, nextRunAt: Date | null, now: Date): boolean {
  return enabled && nextRunAt !== null && nextRunAt.getTime() <= now.getTime();
}

/** Preserve cadence, skipping missed slots instead of replaying downtime. */
export function nextScheduledTime(scheduledFor: Date, intervalMinutes: number, finishedAt: Date): Date {
  if (!isMonitoringInterval(intervalMinutes)) throw new Error('Unsupported monitoring interval.');
  const intervalMs = intervalMinutes * 60_000;
  const slots = Math.max(1, Math.floor((finishedAt.getTime() - scheduledFor.getTime()) / intervalMs) + 1);
  return new Date(scheduledFor.getTime() + slots * intervalMs);
}
