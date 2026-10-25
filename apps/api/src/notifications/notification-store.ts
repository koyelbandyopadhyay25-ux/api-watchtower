import type { Prisma, Endpoint, CheckResult, SchemaChange as SavedChange } from '../generated/prisma/client.js';
import { databaseOperation } from '../database/database-errors.js';
import { incidentTransitions } from './incident-policy.js';

export function createNotificationStore(client: Prisma.TransactionClient) {
  return {
    preference: (endpointId: string) => databaseOperation(() => client.notificationPreference.findUnique({ where: { endpointId } })),
    async configure(endpointId: string, enabled: boolean) {
      return databaseOperation(async () => {
        const previous = await client.notificationPreference.findUnique({ where: { endpointId } });
        const clock = await client.$queryRaw<{ epochMs: bigint }[]>`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "epochMs"`;
        const updatedAt = new Date(Math.max(Number(clock[0]!.epochMs), previous ? previous.updatedAt.getTime() + 1 : 0));
        const preference = await client.notificationPreference.upsert({ where: { endpointId }, create: { endpointId, enabled, updatedAt }, update: { enabled, updatedAt } });
        if (!enabled) await client.emailOutbox.updateMany({ where: { state: 'pending', event: { endpointId } }, data: { state: 'cancelled', finishedAt: new Date(Number(clock[0]!.epochMs)), lastErrorCode: 'preference_disabled' } });
        return preference;
      });
    },
    async observe(endpoint: Endpoint, check: CheckResult & { schemaChanges: SavedChange[] }) {
      if (!endpoint.ownerId) return; // Unclaimed legacy data never generates user notifications.
      return databaseOperation(async () => {
        const active = await client.incident.findMany({ where: { endpointId: endpoint.id, closedAt: null } });
        const transitions = incidentTransitions({ outcome: check.outcome, hasBaseline: endpoint.baselineSchema !== null,
          changes: check.schemaChanges }, active);
        if (!transitions.length) return;
        const enabled = (await client.notificationPreference.findUnique({ where: { endpointId: endpoint.id } }))?.enabled === true;
        for (const transition of transitions) {
          const previous = active.find(incident => incident.kind === transition.kind);
          const incident = transition.action === 'open'
            ? await client.incident.create({ data: { endpointId: endpoint.id, kind: transition.kind, openedCheckId: check.id, openedAt: check.checkedAt, fingerprint: transition.fingerprint } })
            : await client.incident.update({ where: { id: previous!.id }, data: transition.action === 'close'
              ? { closedCheckId: check.id, closedAt: check.checkedAt, resolution: transition.resolution } : { fingerprint: transition.fingerprint } });
          await client.notificationEvent.create({ data: {
            endpointId: endpoint.id, ownerId: endpoint.ownerId!, endpointName: endpoint.name, incidentId: incident.id, checkResultId: check.id,
            kind: transition.event, createdAt: check.checkedAt, ...(enabled ? { outbox: { create: {} } } : {}),
          } });
        }
      });
    },
    resolveForBaseline: (endpointId: string, checkId: string, checkedAt: Date) => databaseOperation(() => client.incident.updateMany({
      where: { endpointId, kind: 'schema', closedAt: null }, data: { closedCheckId: checkId, closedAt: checkedAt, resolution: 'baseline_accepted' },
    })),
    history: (endpointId: string, ownerId: string, limit: number) => databaseOperation(() => client.notificationEvent.findMany({
      where: { endpointId, ownerId, endpoint: { ownerId } }, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { incident: true, checkResult: { include: { schemaChanges: { orderBy: { path: 'asc' } } } },
        outbox: { select: { state: true, attempts: true, availableAt: true, finishedAt: true, lastErrorCode: true, deliveries: { orderBy: { number: 'desc' }, select: { number: true, state: true, startedAt: true, finishedAt: true, errorCode: true } } } } },
    })),
  };
}
