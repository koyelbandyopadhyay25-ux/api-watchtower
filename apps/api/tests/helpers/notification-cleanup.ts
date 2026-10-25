import type { PrismaClient } from '../../src/generated/prisma/client.js';

/** Tests only: callers supply their own newly created endpoint IDs, never all rows. */
export function notificationCleanup(client: PrismaClient, ids: string[]) {
  const event = { endpointId: { in: ids } };
  return [
    client.emailAttempt.deleteMany({ where: { outbox: { event } } }),
    client.emailOutbox.deleteMany({ where: { event } }),
    client.notificationEvent.deleteMany({ where: event }),
    client.incident.deleteMany({ where: { endpointId: { in: ids } } }),
    client.notificationPreference.deleteMany({ where: { endpointId: { in: ids } } }),
  ];
}
