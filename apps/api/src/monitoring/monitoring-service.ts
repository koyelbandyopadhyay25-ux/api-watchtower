import type { createMonitoringRepository, MonitoringStore } from '../database/monitoring-repository.js';
import { DatabaseError } from '../database/database-errors.js';
import { serializeBaseline, type BaselineSchema } from '../database/baseline-schema.js';
import { compareInferredSchemas, inferJsonSchema } from '../schema-comparison/compare-json-schema.js';
import { createSafeJsonFetcher, FETCH_LIMITS } from './safe-json-fetcher.js';
import { validateTarget } from './url-policy.js';
import { isDue, isMonitoringInterval, nextScheduledTime } from '../scheduling/schedule-policy.js';

export class MonitoringError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function createMonitoringService(
  repository: ReturnType<typeof createMonitoringRepository>,
  fetchJson = createSafeJsonFetcher(),
) {
  const activeEndpoints = new Set<string>();

  async function requireEndpoint(id: string, store: MonitoringStore = repository) {
    const endpoint = await store.getEndpoint(id);
    if (!endpoint) throw new MonitoringError(404, 'endpoint_not_found');
    return endpoint;
  }

  async function exclusively<T>(id: string, operation: (store: MonitoringStore, signal: AbortSignal) => Promise<T>) {
    if (activeEndpoints.has(id)) throw new MonitoringError(409, 'check_already_running');
    if (activeEndpoints.size >= FETCH_LIMITS.concurrency) throw new MonitoringError(429, 'check_capacity_reached');
    activeEndpoints.add(id);
    try { return await repository.runExclusive(id, operation); }
    finally { activeEndpoints.delete(id); }
  }

  async function executeCheck(store: MonitoringStore, id: string, signal: AbortSignal, expectedUpdatedAt?: string) {
      const endpoint = await requireEndpoint(id, store);
      if (expectedUpdatedAt !== undefined && endpoint.updatedAt.toISOString() !== expectedUpdatedAt) {
        throw new MonitoringError(409, 'stale_baseline_acceptance');
      }
      const checkedAt = new Date();
      signal.throwIfAborted();
      const response = await fetchJson(endpoint.url, signal);
      signal.throwIfAborted();
      let schema: BaselineSchema | undefined;
      let changes: ReturnType<typeof compareInferredSchemas> = [];
      if (response.ok) {
        schema = inferJsonSchema(response.value);
        if (endpoint.baselineSchema !== null) {
          const baseline = endpoint.baselineSchema as unknown as BaselineSchema;
          serializeBaseline(baseline); // Validate persisted metadata before traversal.
          changes = compareInferredSchemas(baseline, schema);
        }
      }
      const check = await store.recordCheck({
        endpointId: id, checkedAt, httpStatus: response.httpStatus, responseTimeMs: response.responseTimeMs,
        outcome: response.ok ? (changes.length ? 'schema_changed' : 'success') : response.outcome,
        errorCode: response.ok ? undefined : response.errorCode, schemaChanges: changes,
      });
      const comparison = !response.ok ? 'not_compared'
        : endpoint.baselineSchema === null ? 'baseline_missing' : 'compared';
      if (expectedUpdatedAt !== undefined) {
        if (!schema) return { result: { check, comparison }, error: new MonitoringError(422, 'baseline_capture_failed_check_saved') };
        try {
          const accepted = await store.acceptBaseline(id, new Date(expectedUpdatedAt), schema);
          return { result: { check, comparison, endpoint: accepted }, error: null };
        } catch (error) {
          // A stale optimistic update is not a SQL error: commit the actual check,
          // leave the baseline alone, and report conflict after transaction commit.
          if (error instanceof DatabaseError && error.code === 'conflict') return { result: { check, comparison }, error };
          throw error;
        }
      }
      return { result: { check, comparison }, error: null };
  }

  async function runCheck(id: string, expectedUpdatedAt?: string) {
    const attempt = await exclusively(id, (store, signal) => executeCheck(store, id, signal, expectedUpdatedAt));
    if (attempt.error) throw attempt.error;
    return attempt.result;
  }

  return {
    async register(input: { name: string; url: string }) {
      const url = validateTarget(input.url).href;
      return repository.createEndpoint({ name: input.name, url });
    },
    list: (limit: number) => repository.listEndpoints(limit),
    get: (id: string) => requireEndpoint(id),
    check: (id: string) => runCheck(id),
    acceptBaseline: (id: string, expectedUpdatedAt: string) => runCheck(id, expectedUpdatedAt),
    async history(id: string, limit: number) {
      await requireEndpoint(id);
      return repository.listCheckResults(id, limit);
    },

    async schedule(id: string) {
      await requireEndpoint(id);
      return await repository.getSchedule(id) ?? { endpointId: id, enabled: false, intervalMinutes: 15,
        nextRunAt: null, lastStartedAt: null, lastFinishedAt: null, lastErrorCode: null, updatedAt: null };
    },

    async configureSchedule(id: string, enabled: boolean, intervalMinutes: number) {
      if (!isMonitoringInterval(intervalMinutes)) throw new MonitoringError(400, 'unsupported_monitoring_interval');
      return repository.runExclusive(id, async store => {
        const endpoint = await requireEndpoint(id, store);
        if (enabled) validateTarget(endpoint.url);
        const current = await store.getSchedule(id);
        const now = await store.databaseTime();
        // Repeated identical settings do not keep pushing the schedule forward.
        const nextRunAt = !enabled ? null : current?.enabled && current.intervalMinutes === intervalMinutes
          ? current.nextRunAt : current?.enabled ? new Date(now.getTime() + intervalMinutes * 60_000) : now;
        return store.saveSchedule(id, enabled, intervalMinutes, nextRunAt);
      }, false);
    },

    async checkScheduled(id: string) {
      return exclusively(id, async (store, signal) => {
        const schedule = await store.getSchedule(id);
        const startedAt = await store.databaseTime();
        if (!schedule || !isDue(schedule.enabled, schedule.nextRunAt, startedAt)) return null;
        const scheduledFor = schedule.nextRunAt!;
        const { result } = await executeCheck(store, id, signal);
        const finishedAt = await store.databaseTime();
        signal.throwIfAborted();
        await store.recordScheduledCheck(id, result.check.id, scheduledFor);
        await store.finishSchedule(id, startedAt, finishedAt,
          nextScheduledTime(scheduledFor, schedule.intervalMinutes, finishedAt), result.check.errorCode);
        return result;
      });
    },

    async scheduledHistory(id: string, limit: number) {
      await requireEndpoint(id);
      return repository.scheduledHistory(id, limit);
    },
  };
}

export type MonitoringService = ReturnType<typeof createMonitoringService>;
