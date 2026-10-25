import { Prisma, type CheckErrorCode, type CheckOutcome, type PrismaClient } from '../generated/prisma/client.js';
import type { SchemaChange } from '../schema-comparison/schema-types.js';
import { type BaselineSchema, isJsonType, serializeBaseline } from './baseline-schema.js';
import { databaseOperation, DatabaseError } from './database-errors.js';

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

export function createMonitoringRepository(client: PrismaClient) {
  return {
    async createEndpoint(input: { name: string; url: string }) {
      const url = validateEndpoint(input.name, input.url);
      // Baselines always start as SQL NULL. Checks never update this column.
      return databaseOperation(() => client.endpoint.create({
        data: { name: input.name.trim(), url, baselineSchema: Prisma.DbNull },
      }));
    },

    async getEndpoint(id: string) {
      return databaseOperation(() => client.endpoint.findUnique({ where: { id } }));
    },

    async listEndpoints(limit = 50) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid endpoint limit.');
      return databaseOperation(() => client.endpoint.findMany({
        take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }));
    },

    async acceptBaseline(endpointId: string, expectedUpdatedAt: Date, baseline: BaselineSchema) {
      const baselineSchema = serializeBaseline(baseline);
      return databaseOperation(() => client.$transaction(async transaction => {
        const result = await transaction.endpoint.updateMany({
          where: { id: endpointId, updatedAt: expectedUpdatedAt }, data: { baselineSchema },
        });
        if (result.count !== 1) throw new DatabaseError('conflict');
        return transaction.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
      }));
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
        include: { schemaChanges: { orderBy: { path: 'asc' } } },
      }));
    },
  };
}
