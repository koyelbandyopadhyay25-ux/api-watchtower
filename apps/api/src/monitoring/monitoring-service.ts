import type { createMonitoringRepository } from '../database/monitoring-repository.js';
import { serializeBaseline, type BaselineSchema } from '../database/baseline-schema.js';
import { compareInferredSchemas, inferJsonSchema } from '../schema-comparison/compare-json-schema.js';
import { createSafeJsonFetcher, FETCH_LIMITS } from './safe-json-fetcher.js';
import { validateTarget } from './url-policy.js';

export class MonitoringError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function createMonitoringService(
  repository: ReturnType<typeof createMonitoringRepository>,
  fetchJson = createSafeJsonFetcher(),
) {
  const activeEndpoints = new Set<string>();

  async function requireEndpoint(id: string) {
    const endpoint = await repository.getEndpoint(id);
    if (!endpoint) throw new MonitoringError(404, 'endpoint_not_found');
    return endpoint;
  }

  async function runCheck(id: string, expectedUpdatedAt?: string) {
    if (activeEndpoints.has(id)) throw new MonitoringError(409, 'check_already_running');
    if (activeEndpoints.size >= FETCH_LIMITS.concurrency) throw new MonitoringError(429, 'check_capacity_reached');
    activeEndpoints.add(id);
    try {
      const endpoint = await requireEndpoint(id);
      if (expectedUpdatedAt !== undefined && endpoint.updatedAt.toISOString() !== expectedUpdatedAt) {
        throw new MonitoringError(409, 'stale_baseline_acceptance');
      }
      const checkedAt = new Date();
      const response = await fetchJson(endpoint.url);
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
      const check = await repository.recordCheck({
        endpointId: id, checkedAt, httpStatus: response.httpStatus, responseTimeMs: response.responseTimeMs,
        outcome: response.ok ? (changes.length ? 'schema_changed' : 'success') : response.outcome,
        errorCode: response.ok ? undefined : response.errorCode, schemaChanges: changes,
      });
      const comparison = !response.ok ? 'not_compared'
        : endpoint.baselineSchema === null ? 'baseline_missing' : 'compared';
      if (expectedUpdatedAt !== undefined) {
        if (!schema) throw new MonitoringError(422, 'baseline_capture_failed_check_saved');
        const accepted = await repository.acceptBaseline(id, new Date(expectedUpdatedAt), schema);
        return { check, comparison, endpoint: accepted };
      }
      return { check, comparison };
    } finally {
      activeEndpoints.delete(id);
    }
  }

  return {
    async register(input: { name: string; url: string }) {
      const url = validateTarget(input.url).href;
      return repository.createEndpoint({ name: input.name, url });
    },
    list: (limit: number) => repository.listEndpoints(limit),
    get: requireEndpoint,
    check: (id: string) => runCheck(id),
    acceptBaseline: (id: string, expectedUpdatedAt: string) => runCheck(id, expectedUpdatedAt),
    async history(id: string, limit: number) {
      await requireEndpoint(id);
      return repository.listCheckResults(id, limit);
    },
  };
}

export type MonitoringService = ReturnType<typeof createMonitoringService>;
