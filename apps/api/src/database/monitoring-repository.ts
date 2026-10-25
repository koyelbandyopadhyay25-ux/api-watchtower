import { Prisma, type CheckErrorCode, type CheckOutcome, type PrismaClient } from '../generated/prisma/client.js';
import type { SchemaChange } from '../schema-comparison/schema-types.js';
import { type BaselineSchema, isJsonType, serializeBaseline } from './baseline-schema.js';
import { databaseOperation, DatabaseError } from './database-errors.js';
import { acquireCheckLocks } from './check-coordination.js';

export interface RecordCheckInput {
  endpointId: string;
  httpStatus: number | null;
  responseTimeMs: number | null;
  outcome: CheckOutcome;
  errorCode?: CheckErrorCode;
  schemaChanges?: SchemaChange[];
  checkedAt?: Date;
}

function validateEndpoint(name: string, address: string): string {
  if (!name.trim() || name.trim().length > 100) throw new Error('Name must have 1–100 characters.');
  const url = new URL(address);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP(S) URL without credentials, query parameters, or fragments.');
  }
  if (url.href.length > 2048) throw new Error('URL is too long.');
  return url.href;
}

export function createMonitoringStore(client: Prisma.TransactionClient) {
  return {
    async createEndpoint(input: { name: string; url: string; ownerId?: string }) {
      const url = validateEndpoint(input.name, input.url);
      // Baselines always start as SQL NULL. Checks never update this column.
      return databaseOperation(() => client.endpoint.create({
        data: { name: input.name.trim(), url, baselineSchema: Prisma.DbNull, ...(input.ownerId ? { ownerId: input.ownerId } : {}) },
      }));
    },

    async getEndpoint(id: string) {
      return databaseOperation(() => client.endpoint.findUnique({ where: { id } }));
    },

    async listEndpoints(limit = 50, ownerId?: string) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid endpoint limit.');
      return databaseOperation(() => client.endpoint.findMany({
        take: limit, where: ownerId === undefined ? {} : { ownerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }));
    },

    async acceptBaseline(endpointId: string, expectedUpdatedAt: Date, baseline: BaselineSchema) {
      const baselineSchema = serializeBaseline(baseline);
      return databaseOperation(async () => {
        const result = await client.endpoint.updateMany({
          where: { id: endpointId, updatedAt: expectedUpdatedAt }, data: { baselineSchema },
        });
        if (result.count !== 1) throw new DatabaseError('conflict');
        return client.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
      });
    },

    /** An explicit operation is the only way to set, replace, or clear a baseline. */
    async setBaseline(endpointId: string, baseline: BaselineSchema | null) {
      const baselineSchema = baseline === null ? Prisma.DbNull : serializeBaseline(baseline);
      return databaseOperation(() => client.endpoint.update({
        where: { id: endpointId }, data: { baselineSchema },
      }));
    },

    async recordCheck(input: RecordCheckInput) {
      if (input.httpStatus !== null && (!Number.isInteger(input.httpStatus) ||
          input.httpStatus < 100 || input.httpStatus > 599)) throw new Error('Invalid HTTP status.');
      if (input.responseTimeMs !== null && (!Number.isInteger(input.responseTimeMs) ||
          input.responseTimeMs < 0 || input.responseTimeMs > 2_147_483_647)) {
        throw new Error('Response time must be a non-negative 32-bit integer or null.');
      }
      const changes = input.schemaChanges ?? [];
      for (const change of changes) {
        if (!change.path.startsWith('$') ||
            !['added', 'removed', 'type_changed'].includes(change.changeType) ||
            !change.previousTypes.every(isJsonType) || !change.currentTypes.every(isJsonType)) {
          throw new Error('Invalid schema change metadata.');
        }
      }
      // Nested creation is atomic: no partial check if any change cannot be saved.
      // Select fields explicitly so extra runtime fields cannot persist a body.
      return databaseOperation(() => client.checkResult.create({
        data: {
          endpointId: input.endpointId,
          httpStatus: input.httpStatus,
          responseTimeMs: input.responseTimeMs,
          outcome: input.outcome,
          errorCode: input.errorCode,
          checkedAt: input.checkedAt,
          schemaChanges: {
            create: changes.map(change => ({
              path: change.path,
              changeType: change.changeType,
              previousTypes: [...new Set(change.previousTypes)].sort(),
              currentTypes: [...new Set(change.currentTypes)].sort(),
            })),
          },
        },
        include: { schemaChanges: { orderBy: { path: 'asc' } } },
      }));
    },

    async getCheckResult(id: string) {
      return databaseOperation(() => client.checkResult.findUnique({
        where: { id }, include: { schemaChanges: { orderBy: { path: 'asc' } } },
      }));
    },

    async listCheckResults(endpointId: string, limit = 50) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('History limit must be between 1 and 100.');
      }
      return databaseOperation(() => client.checkResult.findMany({
        where: { endpointId }, take: limit,
        orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
        include: { schemaChanges: { orderBy: { path: 'asc' } }, scheduledCheck: { select: { scheduledFor: true } } },
      }));
    },

    async databaseTime() {
      // Epoch milliseconds are independent of timezone and adapter date parsing.
      const rows = await client.$queryRaw<{ epochMs: bigint }[]>`
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "epochMs"
      `;
      return new Date(Number(rows[0]!.epochMs));
    },

    getSchedule: (endpointId: string) => databaseOperation(() => client.endpointSchedule.findUnique({ where: { endpointId } })),

    saveSchedule: (endpointId: string, enabled: boolean, intervalMinutes: number, nextRunAt: Date | null) =>
      databaseOperation(() => client.endpointSchedule.upsert({ where: { endpointId },
        create: { endpointId, enabled, intervalMinutes, nextRunAt }, update: { enabled, intervalMinutes, nextRunAt } })),

    async dueSchedules(limit = 3, excludedIds: string[] = []) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error('Invalid schedule batch size.');
      const now = await this.databaseTime();
      return databaseOperation(() => client.endpointSchedule.findMany({
        where: { enabled: true, nextRunAt: { lte: now }, endpointId: { notIn: excludedIds } }, orderBy: [{ nextRunAt: 'asc' }, { endpointId: 'asc' }], take: limit,
      }));
    },

    recordScheduledCheck: (endpointId: string, checkResultId: string, scheduledFor: Date) =>
      databaseOperation(() => client.scheduledCheck.create({ data: { endpointId, checkResultId, scheduledFor } })),

    finishSchedule: (endpointId: string, startedAt: Date, finishedAt: Date, nextRunAt: Date, errorCode: string | null) =>
      databaseOperation(() => client.endpointSchedule.update({ where: { endpointId },
        data: { lastStartedAt: startedAt, lastFinishedAt: finishedAt, nextRunAt, lastErrorCode: errorCode } })),

    async scheduledHistory(endpointId: string, limit = 50) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid history limit.');
      return databaseOperation(() => client.scheduledCheck.findMany({ where: { endpointId }, take: limit,
        orderBy: [{ scheduledFor: 'desc' }, { checkResultId: 'desc' }],
        include: { checkResult: { include: { schemaChanges: { orderBy: { path: 'asc' } } } } } }));
    },
  };
}

export type MonitoringStore = ReturnType<typeof createMonitoringStore>;

export function createMonitoringRepository(client: PrismaClient) {
  const store = createMonitoringStore(client);
  return {
    ...store,
    acceptBaseline: (id: string, expectedUpdatedAt: Date, baseline: BaselineSchema) =>
      databaseOperation(() => client.$transaction(transaction => createMonitoringStore(transaction).acceptBaseline(id, expectedUpdatedAt, baseline))),

    async runExclusive<T>(endpointId: string, operation: (store: MonitoringStore, signal: AbortSignal) => Promise<T>, capacity = true): Promise<T> {
      // Deliberately bounded transaction: it owns locks AND all result/state writes.
      // The HTTP deadline is 8s; the operation budget is 15s; transaction cap is 25s.
      return client.$transaction(async transaction => {
        await transaction.$executeRaw`SET LOCAL statement_timeout = '3000ms'`;
        await transaction.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
        await acquireCheckLocks(transaction, endpointId, capacity);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try { return await operation(createMonitoringStore(transaction), controller.signal); }
        finally { clearTimeout(timer); controller.abort(); }
      }, { maxWait: 2_000, timeout: 25_000 });
    },
  };
}
