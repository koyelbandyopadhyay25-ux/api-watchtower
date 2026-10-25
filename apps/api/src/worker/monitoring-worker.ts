import { setTimeout as delay } from 'node:timers/promises';
import type { createMonitoringRepository } from '../database/monitoring-repository.js';
import { CheckCoordinationError } from '../database/check-coordination.js';
import { MonitoringError, type MonitoringService } from '../monitoring/monitoring-service.js';

export type WorkerEvent = {
  event: 'worker_poll_failed' | 'scheduled_check_saved' | 'scheduled_check_failed' | 'scheduled_check_skipped';
  endpointId?: string;
  checkId?: string;
  outcome?: string;
};

export function createMonitoringWorker(
  repository: Pick<ReturnType<typeof createMonitoringRepository>, 'dueSchedules'>,
  service: Pick<MonitoringService, 'checkScheduled'>,
  log: (event: WorkerEvent) => void,
  options: { now?: () => number; pollMs?: number; retryMs?: number } = {},
) {
  const now = options.now ?? Date.now;
  const retryAfter = new Map<string, number>();
  let ticking = false;

  async function tick(signal?: AbortSignal) {
    if (ticking || signal?.aborted) return;
    ticking = true;
    try {
      const excluded = [...retryAfter].filter(([, until]) => until > now()).map(([id]) => id);
      const due = await repository.dueSchedules(3, excluded);
      await Promise.all(due.map(async schedule => {
        const endpointId = schedule.endpointId;
        if (signal?.aborted || (retryAfter.get(endpointId) ?? 0) > now()) return;
        try {
          const result = await service.checkScheduled(endpointId);
          retryAfter.delete(endpointId);
          if (result) log({ event: 'scheduled_check_saved', endpointId, checkId: result.check.id, outcome: result.check.outcome });
        } catch (error) {
          const busy = error instanceof CheckCoordinationError ||
            (error instanceof MonitoringError && [409, 429].includes(error.status));
          if (!busy) retryAfter.set(endpointId, now() + (options.retryMs ?? 30_000));
          log({ event: busy ? 'scheduled_check_skipped' : 'scheduled_check_failed', endpointId });
        }
      }));
      // Bound local retry bookkeeping, including schedules disabled elsewhere.
      for (const [id, until] of retryAfter) if (until <= now()) retryAfter.delete(id);
    } catch { log({ event: 'worker_poll_failed' }); }
    finally { ticking = false; }
  }

  async function run(signal: AbortSignal) {
    while (!signal.aborted) {
      await tick(signal); // A second polling tick never overlaps the first.
      if (signal.aborted) break;
      try { await delay(options.pollMs ?? 5_000, undefined, { signal }); }
      catch { if (!signal.aborted) throw new Error('Worker wait failed.'); }
    }
  }
  return { tick, run };
}
