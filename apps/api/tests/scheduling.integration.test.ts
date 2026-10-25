import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabaseClient } from '../src/database/database-client.js';
import { assertDisposableDatabase } from '../src/database/disposable-database.js';
import { createMonitoringRepository } from '../src/database/monitoring-repository.js';
import { CheckCoordinationError } from '../src/database/check-coordination.js';
import { createMonitoringService } from '../src/monitoring/monitoring-service.js';
import { createMonitoringWorker, type WorkerEvent } from '../src/worker/monitoring-worker.js';
import { inferJsonSchema } from '../src/schema-comparison/compare-json-schema.js';
import type { FetchResult } from '../src/monitoring/safe-json-fetcher.js';
import { authSchemaReady } from './helpers/auth-schema-ready.js';

async function schemaReady() {
  if (!process.env.TEST_DATABASE_URL) return false;
  const url = assertDisposableDatabase(process.env.TEST_DATABASE_URL, 'test', process.env.TEST_DATABASE_DISPOSABLE);
  const client = createDatabaseClient(url);
  try {
    const rows = await client.$queryRaw<{ count: number; applied: boolean }[]>`
      SELECT (SELECT count(*)::int FROM pg_tables
        WHERE schemaname = 'public' AND tablename IN ('EndpointSchedule', 'ScheduledCheck')) AS count,
        EXISTS (SELECT 1 FROM public._prisma_migrations
          WHERE migration_name = '20261025121417_add_endpoint_scheduling' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied
    `;
    if (rows[0]?.count === 0 && !rows[0]?.applied) return false; // Approval-gated migration is pending, not a passed DB test.
    if (rows[0]?.count !== 2 || !rows[0].applied) throw new Error('Partial scheduling schema; inspect migration state manually.');
    return true;
  } finally { await client.$disconnect(); }
}

const ready = await authSchemaReady() && await schemaReady();
const success: FetchResult = { ok: true, value: { id: 1 }, httpStatus: 200, responseTimeMs: 8 };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!ready)('scheduled persistence and cross-process coordination (requires approved migration)', () => {
  let first: ReturnType<typeof createDatabaseClient>;
  let second: ReturnType<typeof createDatabaseClient>;
  let repository: ReturnType<typeof createMonitoringRepository>;
  let otherRepository: ReturnType<typeof createMonitoringRepository>;
  const owned: string[] = [];

  beforeAll(async () => {
    const url = assertDisposableDatabase(process.env.TEST_DATABASE_URL, 'test', process.env.TEST_DATABASE_DISPOSABLE);
    first = createDatabaseClient(url); second = createDatabaseClient(url);
    repository = createMonitoringRepository(first); otherRepository = createMonitoringRepository(second);
    const identity = await first.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    expect(identity[0]?.name).toBe('watchtower_test');
  });
  afterEach(async () => {
    await first.$transaction([
      first.checkResult.deleteMany({ where: { endpointId: { in: [...owned] } } }),
      first.endpoint.deleteMany({ where: { id: { in: [...owned] } } }),
    ]);
    owned.length = 0;
  });
  afterAll(async () => { if (first) await first.$disconnect(); if (second) await second.$disconnect(); });
  async function endpoint() {
    const saved = await repository.createEndpoint({ name: 'Scheduler integration test', url: 'https://jsonplaceholder.typicode.com/todos/1' });
    owned.push(saved.id);
    return saved;
  }

  it('leaves existing/new endpoints disabled and does not fetch them', async () => {
    const saved = await endpoint();
    const fetch = vi.fn(async () => success);
    const service = createMonitoringService(repository, fetch);
    expect((await service.schedule(saved.id)).enabled).toBe(false);
    expect(await service.checkScheduled(saved.id)).toBeNull();
    await service.configureSchedule(saved.id, false, 5);
    expect(await service.checkScheduled(saved.id)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await first.checkResult.count({ where: { endpointId: saved.id } })).toBe(0);
  });

  it('persists one due check, advances the DB clock cadence, and does not accept a baseline', async () => {
    const saved = await endpoint();
    const service = createMonitoringService(repository, async () => success);
    await service.configureSchedule(saved.id, true, 5);
    const checked = await service.checkScheduled(saved.id);
    expect(checked?.check.outcome).toBe('success');
    const schedule = await otherRepository.getSchedule(saved.id);
    expect(schedule?.nextRunAt!.getTime()).toBeGreaterThan(schedule!.lastFinishedAt!.getTime());
    expect((await otherRepository.getEndpoint(saved.id))?.baselineSchema).toBeNull();
    const runs = await otherRepository.scheduledHistory(saved.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.checkResult.id).toBe(checked?.check.id);
    expect((await otherRepository.listCheckResults(saved.id))[0]?.scheduledCheck?.scheduledFor).toEqual(runs[0]?.scheduledFor);
    await service.check(saved.id);
    expect((await otherRepository.listCheckResults(saved.id))[0]?.scheduledCheck).toBeNull();
    expect(await service.checkScheduled(saved.id)).toBeNull();
  });

  it('persists structural changes without replacing the explicitly saved baseline', async () => {
    const saved = await endpoint();
    const baseline = inferJsonSchema({ id: 1, old: 'private test fixture' });
    await repository.setBaseline(saved.id, baseline);
    const service = createMonitoringService(repository, async () => ({ ...success, ok: true, value: { id: '1', added: true } }));
    await service.configureSchedule(saved.id, true, 15);
    await service.checkScheduled(saved.id);
    const runs = await otherRepository.scheduledHistory(saved.id);
    expect(runs[0]?.checkResult.outcome).toBe('schema_changed');
    expect(runs[0]?.checkResult.schemaChanges).toHaveLength(3);
    expect((await otherRepository.getEndpoint(saved.id))?.baselineSchema).toEqual(baseline);
    expect(JSON.stringify(runs)).not.toContain('private test fixture');
  });

  it('records timeout failures, advances cadence, and recovers on a later due attempt', async () => {
    const saved = await endpoint();
    let failed = true;
    const service = createMonitoringService(repository, async () => failed
      ? { ok: false, outcome: 'network_error', errorCode: 'timeout', httpStatus: null, responseTimeMs: 8000 }
      : success);
    await service.configureSchedule(saved.id, true, 30);
    expect((await service.checkScheduled(saved.id))?.check.errorCode).toBe('timeout');
    expect((await service.schedule(saved.id)).lastErrorCode).toBe('timeout');
    failed = false;
    // Test-only state for this suite's own endpoint, never backdate runtime activity.
    await first.endpointSchedule.update({ where: { endpointId: saved.id }, data: { nextRunAt: new Date(Date.now() - 600_000) } });
    expect((await service.checkScheduled(saved.id))?.check.outcome).toBe('success');
    expect((await service.schedule(saved.id)).lastErrorCode).toBeNull();
    expect(await otherRepository.scheduledHistory(saved.id)).toHaveLength(2);
  });

  it('makes two independent workers compete for one due endpoint', async () => {
    const saved = await endpoint();
    const entered = deferred(), release = deferred();
    const fetch = vi.fn(async () => { entered.resolve(); await release.promise; return success; });
    const serviceA = createMonitoringService(repository, fetch), serviceB = createMonitoringService(otherRepository, fetch);
    await serviceA.configureSchedule(saved.id, true, 5);
    const events: WorkerEvent[] = [];
    const workerA = createMonitoringWorker(repository, serviceA, event => events.push(event));
    const workerB = createMonitoringWorker(otherRepository, serviceB, event => events.push(event));
    const pending = workerA.tick();
    await entered.promise;
    try {
      await workerB.tick();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(events.some(event => event.event === 'scheduled_check_skipped')).toBe(true);
    } finally { release.resolve(); await pending; }
    expect(await otherRepository.scheduledHistory(saved.id)).toHaveLength(1);
  });

  it('prevents manual checks and scheduled checks from overlapping across API/worker instances', async () => {
    const saved = await endpoint();
    const entered = deferred(), release = deferred();
    const manual = createMonitoringService(repository, async () => { entered.resolve(); await release.promise; return success; });
    const scheduled = createMonitoringService(otherRepository, async () => success);
    await scheduled.configureSchedule(saved.id, true, 5);
    const pending = manual.check(saved.id);
    await entered.promise;
    try { await expect(scheduled.checkScheduled(saved.id)).rejects.toBeInstanceOf(CheckCoordinationError); }
    finally { release.resolve(); await pending; }
    expect(await scheduled.checkScheduled(saved.id)).not.toBeNull();
    expect(await otherRepository.listCheckResults(saved.id)).toHaveLength(2);
  });

  it('blocks manual checks and baseline acceptance while a scheduled check owns the endpoint', async () => {
    const saved = await endpoint();
    const entered = deferred(), release = deferred();
    const scheduled = createMonitoringService(repository, async () => { entered.resolve(); await release.promise; return success; });
    const manual = createMonitoringService(otherRepository, async () => success);
    await scheduled.configureSchedule(saved.id, true, 5);
    const pending = scheduled.checkScheduled(saved.id);
    await entered.promise;
    try {
      await expect(manual.check(saved.id)).rejects.toBeInstanceOf(CheckCoordinationError);
      await expect(manual.acceptBaseline(saved.id, saved.updatedAt.toISOString())).rejects.toBeInstanceOf(CheckCoordinationError);
    } finally { release.resolve(); await pending; }
    expect((await otherRepository.getEndpoint(saved.id))?.baselineSchema).toBeNull();
  });

  it('enforces three global check slots across independent repositories', async () => {
    const ids = await Promise.all(Array.from({ length: 4 }, () => endpoint()));
    let enteredCount = 0;
    const entered = deferred(), release = deferred();
    const serviceA = createMonitoringService(repository, async () => { if (++enteredCount === 3) entered.resolve(); await release.promise; return success; });
    const serviceB = createMonitoringService(otherRepository, async () => success);
    const pending = ids.slice(0, 3).map(item => serviceA.check(item.id));
    await entered.promise;
    try { await expect(serviceB.check(ids[3]!.id)).rejects.toMatchObject({ reason: 'capacity' }); }
    finally { release.resolve(); await Promise.all(pending); }
    expect((await serviceB.check(ids[3]!.id)).check.outcome).toBe('success');
  });

  it('rolls back an interrupted attempt, releases locks, and resumes due work after restart', async () => {
    const saved = await endpoint();
    const service = createMonitoringService(repository, async () => { throw new Error('private failure'); });
    await service.configureSchedule(saved.id, true, 5);
    const before = await service.schedule(saved.id);
    await expect(service.checkScheduled(saved.id)).rejects.toThrow();
    expect(await first.checkResult.count({ where: { endpointId: saved.id } })).toBe(0);
    expect((await service.schedule(saved.id)).nextRunAt).toEqual(before.nextRunAt);
    const restarted = createMonitoringWorker(otherRepository, createMonitoringService(otherRepository, async () => success), () => {});
    await restarted.tick();
    expect(await repository.scheduledHistory(saved.id)).toHaveLength(1);
    await createMonitoringWorker(repository, createMonitoringService(repository, async () => success), () => {}).tick();
    expect(await repository.scheduledHistory(saved.id)).toHaveLength(1);
  });

  it('applies idempotent settings, reschedules interval changes, and persists disablement', async () => {
    const saved = await endpoint();
    const service = createMonitoringService(repository, async () => success);
    const first = await service.configureSchedule(saved.id, true, 5);
    expect((await service.configureSchedule(saved.id, true, 5)).nextRunAt).toEqual(first.nextRunAt);
    const changed = await service.configureSchedule(saved.id, true, 60);
    expect(changed.nextRunAt!.getTime()).toBeGreaterThan(first.nextRunAt!.getTime());
    const disabled = await service.configureSchedule(saved.id, false, 60);
    expect(disabled.nextRunAt).toBeNull();
    expect(await service.checkScheduled(saved.id)).toBeNull();
  });

  it('enforces interval and enabled/due invariants in PostgreSQL too', async () => {
    const saved = await endpoint();
    await expect(first.endpointSchedule.create({ data: { endpointId: saved.id, intervalMinutes: 1 } })).rejects.toThrow();
    await expect(first.endpointSchedule.create({ data: { endpointId: saved.id, enabled: true, nextRunAt: null } })).rejects.toThrow();
    expect(await repository.getSchedule(saved.id)).toBeNull();
  });
});
