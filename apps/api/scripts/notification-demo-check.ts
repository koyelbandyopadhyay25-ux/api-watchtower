/** Opt-in live E2E fault injection: real secure fetcher, stricter test-only deadline. */
import 'dotenv/config';
import { createDatabaseClient } from '../src/database/database-client.js';
import { createMonitoringRepository } from '../src/database/monitoring-repository.js';
import { createMonitoringService } from '../src/monitoring/monitoring-service.js';
import { createSafeJsonFetcher } from '../src/monitoring/safe-json-fetcher.js';

const [endpointId, mode] = process.argv.slice(2);
if (process.env.WATCHTOWER_NOTIFICATION_DEMO !== 'true' || !endpointId || !['timeout', 'normal'].includes(mode ?? '') || !process.env.DATABASE_URL) throw new Error('Explicit local demonstration opt-in required.');
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || (url.port || '5432') !== '5432' || url.pathname !== '/watchtower_dev' || process.env.NODE_ENV !== 'development') throw new Error('Exact local development database required.');
const client = createDatabaseClient(process.env.DATABASE_URL);
try {
  const endpoint = await client.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
  if (!endpoint.ownerId || !endpoint.name.startsWith('Phase 6B notification verification ') || endpoint.url !== 'https://jsonplaceholder.typicode.com/todos/1') throw new Error('Only a newly registered demonstration endpoint is allowed.');
  // This changes neither production limits nor DNS/TLS/URL validation. No request
  // or response is mocked. A timed-out observation is not an upstream outage claim.
  const fetcher = createSafeJsonFetcher(mode === 'timeout' ? { timeoutMs: 1 } : {});
  const result = await createMonitoringService(createMonitoringRepository(client), fetcher).check(endpoint.id, endpoint.ownerId);
  console.log(JSON.stringify({ checkId: result.check.id, outcome: result.check.outcome, errorCode: result.check.errorCode, httpStatus: result.check.httpStatus }));
} finally { await client.$disconnect(); }
