import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { databaseOperation } from '../database/database-errors.js';
import { EMAIL_LIMITS, retryDelayMs, type DeliveryResult } from './delivery-policy.js';

async function databaseTime(client: Prisma.TransactionClient) {
  const rows = await client.$queryRaw<{ epochMs: bigint }[]>`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "epochMs"`;
  return new Date(Number(rows[0]!.epochMs));
}

export function createOutboxRepository(client: PrismaClient) {
  return {
    async claim() {
      return databaseOperation(() => client.$transaction(async transaction => {
        // Separate key space from monitoring capacity. Short gate bounds active
        // leases across ALL dispatchers without holding a transaction during SMTP.
        const gate = await transaction.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(731422::int, 0::int) AS acquired`;
        if (!gate[0]?.acquired) return null;
        const now = await databaseTime(transaction);
        const active = await transaction.emailOutbox.count({ where: { state: 'processing', leaseExpiresAt: { gt: now } } });
        if (active >= EMAIL_LIMITS.concurrency) return null;
        const rows = await transaction.$queryRaw<{ eventId: string }[]>`
          SELECT "eventId" FROM "EmailOutbox"
          WHERE ("state" = 'pending' AND "availableAt" <= ${now}) OR ("state" = 'processing' AND "leaseExpiresAt" <= ${now})
          ORDER BY "availableAt", "eventId" LIMIT 1 FOR UPDATE SKIP LOCKED
        `;
        if (!rows[0]) return null;
        const candidate = await transaction.emailOutbox.findUniqueOrThrow({ where: { eventId: rows[0].eventId } });
        if (candidate.state === 'processing') await transaction.emailAttempt.updateMany({
          where: { eventId: candidate.eventId, state: 'in_progress' }, data: { state: 'interrupted', finishedAt: now, errorCode: 'lease_expired' },
        });
        if (candidate.attempts >= EMAIL_LIMITS.maxAttempts) {
          await transaction.emailOutbox.update({ where: { eventId: candidate.eventId }, data: { state: 'failed', finishedAt: now, leaseToken: null, leaseExpiresAt: null, lastErrorCode: 'attempts_exhausted' } });
          return null;
        }
        const leaseToken = randomUUID(); const number = candidate.attempts + 1;
        const claimed = await transaction.emailOutbox.updateMany({ where: { eventId: candidate.eventId, state: candidate.state, leaseToken: candidate.leaseToken }, data: {
          state: 'processing', attempts: number, leaseToken, leaseExpiresAt: new Date(now.getTime() + EMAIL_LIMITS.leaseMs), finishedAt: null,
        } });
        if (claimed.count !== 1) return null; // A disable request may have cancelled it.
        await transaction.emailAttempt.create({ data: { eventId: candidate.eventId, number, leaseToken, startedAt: now } });
        return transaction.emailOutbox.findUniqueOrThrow({ where: { eventId: candidate.eventId },
          include: { event: { include: { endpoint: true, checkResult: { include: { schemaChanges: { orderBy: { path: 'asc' } } } } } } } });
      }, { maxWait: 2000, timeout: 5000 }));
    },
    async allowed(eventId: string, leaseToken: string) {
      return databaseOperation(async () => {
        const current = await client.emailOutbox.findUnique({ where: { eventId }, include: { event: { include: { endpoint: { include: { notificationPreference: true } } } } } });
        return current?.state === 'processing' && current.leaseToken === leaseToken && current.event.ownerId === current.event.endpoint.ownerId && current.event.endpoint.notificationPreference?.enabled === true;
      });
    },
    async complete(job: { eventId: string; leaseToken: string | null; attempts: number }, result: DeliveryResult) {
      return databaseOperation(() => client.$transaction(async transaction => {
        const now = await databaseTime(transaction);
        const preference = await transaction.emailOutbox.findUnique({ where: { eventId: job.eventId }, include: { event: { include: { endpoint: { include: { notificationPreference: true } } } } } });
        if (!preference || preference.state !== 'processing' || preference.leaseToken !== job.leaseToken) return false;
        const optedIn = preference.event.ownerId === preference.event.endpoint.ownerId && preference.event.endpoint.notificationPreference?.enabled === true;
        const retry = result.kind === 'failed' && result.retryable && job.attempts < EMAIL_LIMITS.maxAttempts && optedIn;
        const state = result.kind === 'accepted' ? 'smtp_accepted' : result.kind === 'cancelled' || !optedIn ? 'cancelled' : retry ? 'pending' : 'failed';
        const changed = await transaction.emailOutbox.updateMany({ where: { eventId: job.eventId, state: 'processing', leaseToken: job.leaseToken }, data: {
          state, availableAt: retry ? new Date(now.getTime() + retryDelayMs(job.attempts)) : preference.availableAt,
          finishedAt: retry ? null : now, leaseToken: null, leaseExpiresAt: null,
          lastErrorCode: result.kind === 'failed' ? result.code : result.kind === 'cancelled' ? 'preference_disabled' : null,
        } });
        if (changed.count !== 1) return false;
        await transaction.emailAttempt.update({ where: { eventId_number: { eventId: job.eventId, number: job.attempts } }, data: {
          state: result.kind === 'accepted' ? 'smtp_accepted' : state === 'cancelled' ? 'cancelled' : retry ? 'retry_scheduled' : 'permanent_failure',
          finishedAt: now, errorCode: result.kind === 'failed' ? result.code : result.kind === 'cancelled' ? 'preference_disabled' : null,
        } });
        return true;
      }, { maxWait: 2000, timeout: 5000 }));
    },
  };
}
export type OutboxRepository = ReturnType<typeof createOutboxRepository>;
export type EmailJob = NonNullable<Awaited<ReturnType<OutboxRepository['claim']>>>;
